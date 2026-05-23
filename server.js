import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";

import { MongoClient } from "mongodb";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
const upload = multer({
  dest: "uploads/",
});

const client = new MongoClient(process.env.MONGODB_ATLAS_URI);

let collection;

async function connectDB() {
  await client.connect();

  const db = client.db(process.env.MONGODB_DB_NAME);
  collection = db.collection(process.env.MONGODB_COLLECTION_NAME);

  console.log("MongoDB connected");
}

function createFileId(filename) {
  return `${Date.now()}-${filename.replace(/\s+/g, "-").toLowerCase()}`;
}

async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".pdf") {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === ".txt") {
    return await fs.readFile(filePath, "utf8");
  }

  throw new Error("Unsupported file type. Please upload PDF, DOCX, or TXT.");
}

function getEmbeddingsModel() {
  return new OpenAIEmbeddings({
    model: "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function getVectorStore() {
  return new MongoDBAtlasVectorSearch(getEmbeddingsModel(), {
    collection,
    indexName: process.env.MONGODB_VECTOR_INDEX_NAME,
    textKey: "text",
    embeddingKey: "embedding",
  });
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const fileId = createFileId(req.file.originalname);

    const rawText = await extractTextFromFile(
      req.file.path,
      req.file.originalname,
    );

    if (!rawText || rawText.trim().length < 20) {
      return res.status(400).json({
        success: false,
        message: "File has no readable text",
      });
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const chunks = await splitter.splitText(rawText);

    const documents = chunks.map((chunk, index) => {
      return new Document({
        pageContent: chunk,
        metadata: {
          fileId,
          fileName: req.file.originalname,
          chunkIndex: index,
          uploadedAt: new Date().toISOString(),
        },
      });
    });

    const vectorStore = getVectorStore();

    await vectorStore.addDocuments(documents);

    await fs.unlink(req.file.path);

    return res.json({
      success: true,
      message: "File uploaded, chunked, embedded, and stored successfully",
      fileId,
      fileName: req.file.originalname,
      totalChunks: chunks.length,
      chunkStrategy: {
        type: "RecursiveCharacterTextSplitter",
        chunkSize: 1000,
        chunkOverlap: 200,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Upload failed",
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { question, fileId } = req.body;

    if (!question) {
      return res.status(400).json({
        success: false,
        message: "Question is required",
      });
    }

    if (!fileId) {
      return res.status(400).json({
        success: false,
        message: "fileId is required",
      });
    }

    const vectorStore = getVectorStore();

    const relevantDocs = await vectorStore.similaritySearch(question, 4, {
      preFilter: {
        fileId: {
          $eq: fileId,
        },
      },
    });

    const context = relevantDocs
      .map((doc, index) => {
        return `Source ${index + 1}:\n${doc.pageContent}`;
      })
      .join("\n\n---\n\n");

    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.2,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const systemPrompt = `
You are a helpful file-based assistant.

Rules:
1. Answer only using the provided context from the uploaded file.
2. If the answer is not in the context, say: "I could not find this information in the uploaded file."
3. Do not invent facts.
4. Keep the answer clear, direct, and structured.
5. If useful, include short bullet points.
6. Mention which source chunks were used when relevant.
`;

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(`
User question:
${question}

Retrieved context:
${context}
`),
    ]);

    return res.json({
      success: true,
      question,
      answer: response.content,
      sources: relevantDocs.map((doc) => ({
        fileName: doc.metadata.fileName,
        chunkIndex: doc.metadata.chunkIndex,
        textPreview: doc.pageContent.slice(0, 250),
      })),
    });
  } catch (error) {
    console.error("Chat error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Chat failed",
    });
  }
});

app.get("/", (req, res) => {
  res.json({
    message: "RAG File Chatbot API is running",
    routes: {
      upload: "POST /api/upload",
      chat: "POST /api/chat",
    },
  });
});

connectDB()
  .then(() => {
    app.listen(process.env.PORT || 5000, () => {
      console.log(`Server running on port ${process.env.PORT || 5000}`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
    process.exit(1);
  });
