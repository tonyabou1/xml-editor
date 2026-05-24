import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDitaRngSchema } from "../backend/ditaRngSchema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const ditaOtHome = process.env.DITA_OT_HOME || path.join(projectRoot, "tools", "dita-ot-4.4");
const outputPath = path.join(projectRoot, "backend", "schema", "dita-1.3-rng-schema.generated.json");

const schema = await buildDitaRngSchema({ ditaOtHome, force: true });

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

console.log(`Generated DITA RNG schema index: ${outputPath}`);
console.log(`Elements: ${Object.keys(schema.elements).length}`);
console.log(`RNG files: ${schema.stats.rngFiles}`);
