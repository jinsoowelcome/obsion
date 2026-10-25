type WriteNote = (path: string, content: string) => Promise<unknown>;

/** Serializes complete draft drains, including flush calls made during a write. */
export class DraftWriter {
  private drafts = new Map<string, string>();
  private tail: Promise<void> = Promise.resolve();
  private writer: WriteNote;

  constructor(writer: WriteNote) { this.writer = writer; }

  set(path: string, content: string): void { this.drafts.set(path, content); }

  get size(): number { return this.drafts.size; }

  flush(): Promise<void> {
    const task = this.tail.then(async () => {
      // Read the pending map when this turn starts, not when flush is requested.
      // An earlier failed turn can restore drafts while this one is queued.
      while (this.drafts.size) {
        const batch = [...this.drafts.entries()];
        this.drafts.clear();
        for (let index = 0; index < batch.length; index += 1) {
          const [path, content] = batch[index];
          try { await this.writer(path, content); }
          catch (error) {
            // Preserve newer edits made during the failed write. Only restore
            // unsaved batch entries that do not already have newer drafts.
            for (const [remainingPath, remainingContent] of batch.slice(index)) {
              if (!this.drafts.has(remainingPath)) this.drafts.set(remainingPath, remainingContent);
            }
            throw error;
          }
        }
      }
    });
    // Keep retries possible, while returning the real rejection to this caller.
    this.tail = task.catch(() => {});
    return task;
  }
}
