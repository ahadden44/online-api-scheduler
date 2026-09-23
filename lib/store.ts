import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPreviewStore } from "@/lib/seed";
import type { MedSlotStore } from "@/lib/types";

const filePath = path.join(process.cwd(), "data", "medslot.json");

let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function readStore(): Promise<MedSlotStore> {
  return withLock(async () => {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as MedSlotStore;
      if (parsed.version !== 1) throw new Error("unknown store");
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && code !== "ENOENT") {
        /* fall through and rebuild a readable preview if the file is corrupt */
      }
      const seeded = createPreviewStore();
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(seeded, null, 2));
      return seeded;
    }
  });
}

export async function updateStore(mutate: (store: MedSlotStore) => void): Promise<MedSlotStore> {
  return withLock(async () => {
    let store: MedSlotStore;
    try {
      store = JSON.parse(await readFile(filePath, "utf8")) as MedSlotStore;
    } catch {
      store = createPreviewStore();
    }
    mutate(store);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(store, null, 2));
    return store;
  });
}
