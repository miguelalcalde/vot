import { fileURLToPath, pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL?.startsWith("file:")) {
    const candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
    try {
      if ((await stat(candidate)).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    } catch {}
  }
  return nextResolve(specifier, context);
}
