const API_BASE_URL = "http://localhost:5000";

const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const uploadStatus = document.getElementById("uploadStatus");

const fileInfo = document.getElementById("fileInfo");
const fileNameEl = document.getElementById("fileName");
const fileIdEl = document.getElementById("fileId");
const totalChunksEl = document.getElementById("totalChunks");

const chatSection = document.getElementById("chatSection");
const chatBox = document.getElementById("chatBox");
const questionInput = document.getElementById("questionInput");
const askBtn = document.getElementById("askBtn");

let currentFileId = null;

function setStatus(message, type = "") {
  uploadStatus.textContent = message;
  uploadStatus.className = `status ${type}`;
}

function addMessage(type, text, sources = []) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${type}`;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = type === "user" ? "You" : "Assistant";

  const content = document.createElement("div");
  content.textContent = text;

  messageDiv.appendChild(label);
  messageDiv.appendChild(content);

  if (sources.length > 0) {
    const sourcesDiv = document.createElement("div");
    sourcesDiv.className = "sources";

    const title = document.createElement("strong");
    title.textContent = "Sources";

    const ul = document.createElement("ul");

    sources.forEach((source) => {
      const li = document.createElement("li");
      li.textContent = `Chunk ${source.chunkIndex}: ${source.textPreview}`;
      ul.appendChild(li);
    });

    sourcesDiv.appendChild(title);
    sourcesDiv.appendChild(ul);
    messageDiv.appendChild(sourcesDiv);
  }

  chatBox.appendChild(messageDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

uploadBtn.addEventListener("click", async () => {
  try {
    const file = fileInput.files[0];

    if (!file) {
      setStatus("Please select a file first.", "error");
      return;
    }

    const allowedTypes = [".txt", ".pdf", ".docx"];
    const fileExtension = file.name
      .substring(file.name.lastIndexOf("."))
      .toLowerCase();

    if (!allowedTypes.includes(fileExtension)) {
      setStatus("Only TXT, PDF, and DOCX files are supported.", "error");
      return;
    }

    uploadBtn.disabled = true;
    setStatus("Uploading and processing file...", "");

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "Upload failed");
    }

    currentFileId = data.fileId;

    fileNameEl.textContent = data.fileName;
    fileIdEl.textContent = data.fileId;
    totalChunksEl.textContent = data.totalChunks;

    fileInfo.classList.remove("hidden");
    chatSection.classList.remove("hidden");

    chatBox.innerHTML = "";

    setStatus("File uploaded and indexed successfully.", "success");

    addMessage(
      "bot",
      "File is ready. You can now ask questions based on the uploaded content.",
    );
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    uploadBtn.disabled = false;
  }
});

askBtn.addEventListener("click", askQuestion);

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    askQuestion();
  }
});

async function askQuestion() {
  try {
    const question = questionInput.value.trim();

    if (!currentFileId) {
      addMessage("bot", "Please upload a file first.");
      return;
    }

    if (!question) {
      addMessage("bot", "Please type a question first.");
      return;
    }

    addMessage("user", question);
    questionInput.value = "";

    askBtn.disabled = true;
    addMessage("bot", "Thinking...");

    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileId: currentFileId,
        question,
      }),
    });

    const data = await response.json();

    const thinkingMessage = chatBox.lastChild;
    if (
      thinkingMessage &&
      thinkingMessage.textContent.includes("Thinking...")
    ) {
      thinkingMessage.remove();
    }

    if (!response.ok || !data.success) {
      throw new Error(data.message || "Chat failed");
    }

    addMessage("bot", data.answer, data.sources || []);
  } catch (error) {
    const thinkingMessage = chatBox.lastChild;
    if (
      thinkingMessage &&
      thinkingMessage.textContent.includes("Thinking...")
    ) {
      thinkingMessage.remove();
    }

    addMessage("bot", error.message);
  } finally {
    askBtn.disabled = false;
  }
}
