import { rm, mkdir, cp, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(import.meta.url), "../..");
const publicDir = join(rootDir, "public");
const distDir = join(rootDir, "dist");

async function build() {
  console.log("A iniciar build da aplicação frontend Bot Nur...");

  // 1. Limpar e criar diretório dist
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  // 2. Copiar ficheiros estáticos de public para dist
  await cp(publicDir, distDir, { recursive: true });

  // 3. Injetar BOT_NUR_API_BASE se configurado no ambiente de build
  const apiBase = (process.env.BOT_NUR_API_BASE || process.env.BACKEND_URL || "").trim().replace(/\/+$/, "");
  if (apiBase) {
    console.log(`A configurar BOT_NUR_API_BASE no build: ${apiBase}`);
    const indexPath = join(distDir, "index.html");
    let html = await readFile(indexPath, "utf8");
    const scriptTag = `<script>window.BOT_NUR_API_BASE = "${apiBase}";</script>\n  `;
    html = html.replace("<head>", `<head>\n  ${scriptTag}`);
    await writeFile(indexPath, html, "utf8");
  }

  // 4. Criar .nojekyll para evitar processamento pelo GitHub Pages Jekyll
  await writeFile(join(distDir, ".nojekyll"), "");

  // 4. Verificar ficheiros essenciais gerados
  const requiredFiles = ["index.html", "app.js", "styles.css", "nur-mark.svg", ".nojekyll"];
  for (const file of requiredFiles) {
    const filePath = join(distDir, file);
    try {
      await stat(filePath);
    } catch {
      throw new Error(`Ficheiro obrigatório não encontrado no build: ${file}`);
    }
  }

  console.log("Build concluído com sucesso em dist/");
}

build().catch((error) => {
  console.error("Erro durante o build:", error);
  process.exit(1);
});
