/**
 * A figure fetched from the gateway on demand: whoever reads it asks it to refresh, which starts one fetch at a time,
 * at most once every `every` milliseconds unless asked for at once. A failed fetch keeps the last figure, marked stale.
 */
export class Fetched<T> {
  value: T | null = null;
  fetchedAt: number | null = null;
  problem: string | null = null;
  private startedAt = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | null = null;
  private dueAtOnce = false;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly every: number,
    private readonly changed: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The next refresh starts whatever the time, such as after a turn that spent something. */
  due() {
    this.dueAtOnce = true;
  }

  refresh(): Promise<void> {
    if (this.running) return this.running;
    if (!this.dueAtOnce && this.now() - this.startedAt < this.every) return Promise.resolve();
    this.dueAtOnce = false;
    this.startedAt = this.now();
    this.running = this.load()
      .then(
        (value) => {
          this.value = value;
          this.fetchedAt = this.now();
          this.problem = null;
        },
        (error: unknown) => {
          this.problem = error instanceof Error ? error.message : String(error);
        },
      )
      .finally(() => {
        this.running = null;
        tellQuietly(this.changed);
      });
    return this.running;
  }

  /** The last fetch failed, or the figure is older than three refreshes. */
  get stale(): boolean {
    return this.problem !== null || (this.fetchedAt !== null && this.now() - this.fetchedAt > 3 * this.every);
  }

  get loading(): boolean {
    return this.running !== null;
  }
}

/** Fetches run in Mirador's host process, so what they set off after them must not reject there. */
function tellQuietly(changed: () => void) {
  try {
    changed();
  } catch (error) {
    console.error("litellm: telling of a fetched figure failed:", error);
  }
}
