const MAX_ATTACHMENTS = 3;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

const FILE_TYPES = {
  ".jpg": { mimeType: "image/jpeg", category: "image", maxBytes: 5 * 1024 * 1024 },
  ".jpeg": { mimeType: "image/jpeg", category: "image", maxBytes: 5 * 1024 * 1024 },
  ".png": { mimeType: "image/png", category: "image", maxBytes: 5 * 1024 * 1024 },
  ".webp": { mimeType: "image/webp", category: "image", maxBytes: 5 * 1024 * 1024 },
  ".mp4": { mimeType: "video/mp4", category: "video", maxBytes: 12 * 1024 * 1024 },
  ".webm": { mimeType: "video/webm", category: "video", maxBytes: 12 * 1024 * 1024 },
  ".mp3": { mimeType: "audio/mp3", category: "audio", maxBytes: 5 * 1024 * 1024 },
  ".wav": { mimeType: "audio/wav", category: "audio", maxBytes: 5 * 1024 * 1024 },
  ".ogg": { mimeType: "audio/ogg", category: "audio", maxBytes: 5 * 1024 * 1024 },
  ".aac": { mimeType: "audio/aac", category: "audio", maxBytes: 5 * 1024 * 1024 },
  ".flac": { mimeType: "audio/flac", category: "audio", maxBytes: 5 * 1024 * 1024 },
  ".pdf": { mimeType: "application/pdf", category: "document", maxBytes: 8 * 1024 * 1024 },
  ".txt": { mimeType: "text/plain", category: "text", maxBytes: 1 * 1024 * 1024 },
  ".csv": { mimeType: "text/csv", category: "text", maxBytes: 1 * 1024 * 1024 },
};

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = "INVALID_MEDIA";
  return error;
}

function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function safeName(name) {
  const baseName = String(name || "").split(/[\\/]/).at(-1) || "ficheiro";
  const safe = baseName.normalize("NFC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return safe || "ficheiro";
}

function hasExpectedSignature(bytes, extension) {
  if (extension === ".jpg" || extension === ".jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (extension === ".png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === ".webp") {
    return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF"
      && bytes.toString("ascii", 8, 12) === "WEBP";
  }
  if (extension === ".mp4") return bytes.length >= 8 && bytes.toString("ascii", 4, 8) === "ftyp";
  if (extension === ".webm") return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (extension === ".pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === ".wav") return bytes.length >= 12
    && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WAVE";
  if (extension === ".ogg") return bytes.toString("ascii", 0, 4) === "OggS";
  if (extension === ".flac") return bytes.toString("ascii", 0, 4) === "fLaC";
  if (extension === ".mp3") {
    return bytes.toString("ascii", 0, 3) === "ID3"
      || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  if (extension === ".aac") return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (extension === ".txt" || extension === ".csv") {
    return bytes.length > 0 && !bytes.includes(0);
  }
  return false;
}

export function validateUploadedAttachments(input) {
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENTS) {
    throw invalid(`Podes anexar no máximo ${MAX_ATTACHMENTS} ficheiros por mensagem.`);
  }
  let totalBytes = 0;

  return input.map((item) => {
    if (!item || typeof item !== "object" || typeof item.data !== "string") {
      throw invalid("Um dos ficheiros enviados não tem dados válidos.");
    }
    const name = safeName(item.name);
    const extension = extensionOf(name);
    let type = FILE_TYPES[extension];
    if (!type) {
      throw invalid("Formato não suportado. Usa imagens JPG, PNG ou WEBP; áudio MP3, WAV, OGG, AAC ou FLAC; vídeo MP4/WEBM; PDF, TXT ou CSV.");
    }
    const claimedType = typeof item.mimeType === "string" ? item.mimeType.toLowerCase() : "";
    if (extension === ".webm" && claimedType === "audio/webm") {
      type = { mimeType: "audio/webm", category: "audio", maxBytes: 5 * 1024 * 1024 };
    }
    const browserMimeAlias = extension === ".mp3" && claimedType === "audio/mpeg";
    if (claimedType && claimedType !== "application/octet-stream"
      && claimedType !== type.mimeType && !browserMimeAlias) {
      throw invalid("O tipo declarado do ficheiro não corresponde ao formato.");
    }
    if (item.data.length > 4 * Math.ceil(type.maxBytes / 3)) {
      throw invalid("Um dos ficheiros excede o limite permitido para este formato.", 413);
    }
    const estimatedBytes = Math.floor(item.data.length * 3 / 4)
      - (item.data.endsWith("==") ? 2 : item.data.endsWith("=") ? 1 : 0);
    if (estimatedBytes > type.maxBytes) {
      throw invalid("Um dos ficheiros excede o limite permitido para este formato.", 413);
    }
    totalBytes += estimatedBytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw invalid("O tamanho total dos ficheiros excede 12 MB.", 413);
    }
    if (
      item.data.length % 4 !== 0
      || /[^A-Za-z0-9+/=]/.test(item.data)
      || item.data.slice(0, item.data.length - (item.data.endsWith("==") ? 2 : item.data.endsWith("=") ? 1 : 0)).includes("=")
    ) {
      throw invalid("Um dos ficheiros enviados está corrompido.");
    }

    const bytes = Buffer.from(item.data, "base64");
    if (bytes.toString("base64") !== item.data || !hasExpectedSignature(bytes, extension)) {
      throw invalid(`O conteúdo de "${name}" não corresponde a um ficheiro válido desse formato.`);
    }

    let text;
    if (type.category === "text") {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw invalid(`Não foi possível ler o texto de "${name}" em UTF-8.`);
      }
      if (text.length > 100_000) throw invalid(`O documento "${name}" contém texto a mais.`);
    }

    return {
      name,
      mimeType: type.mimeType,
      category: type.category,
      size: bytes.length,
      data: item.data,
      ...(text === undefined ? {} : { text }),
    };
  });
}
