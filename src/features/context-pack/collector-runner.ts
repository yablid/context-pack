import type { Artifact, CollectorRunResult, CollectorHealth } from '../../core/types.js';
import type { Collector, CollectorContext } from '../../core/contracts/collector.js';
import { CollectorTimeoutError } from '../../errors/specific-errors.js';

export class CollectorRunner {
  static async runCollectors(
    collectors: Collector[],
    ctx: CollectorContext,
    opts: { timeout?: number; memoryLimitMB?: number; retries?: number; concurrency?: number }
  ): Promise<CollectorRunResult[]> {
    const concurrency = opts.concurrency ?? Math.min(3, collectors.length); // Default: max 3 concurrent

    // Create semaphore for bounded concurrency
    let running = 0;
    const pending: Array<() => void> = [];

    const acquire = (): Promise<void> => {
      return new Promise((resolve) => {
        if (running < concurrency) {
          running++;
          resolve();
        } else {
          pending.push(resolve);
        }
      });
    };

    const release = (): void => {
      running--;
      const next = pending.shift();
      if (next) {
        running++;
        next();
      }
    };

    // Run single collector with retry logic
    const runCollector = async (collector: Collector): Promise<CollectorRunResult> => {
      await acquire();

      try {
        const maxAttempts = Math.max(0, opts.retries ?? 0) + 1;
        let attempt = 0;
        let lastError: any = null;
        let finalArtifacts: Artifact[] = [];
        let status: CollectorHealth['status'] = 'failed';
        const start = Date.now();

        while (attempt < maxAttempts) {
          try {
            const artifacts = await this.runWithTimeout(collector, ctx, opts.timeout ?? 30000);
            finalArtifacts = artifacts;
            status = 'ok';
            lastError = null;
            break;
          } catch (e: any) {
            lastError = e;
            // Do not retry on timeout
            if (e?.name === 'CollectorTimeoutError') {
              status = 'timeout';
              break;
            }
            attempt++;
            if (attempt >= maxAttempts) {
              status = 'failed';
              break;
            }
          }
        }

        if (status === 'ok') {
          return {
            artifacts: finalArtifacts,
            success: true,
            health: { name: collector.name, status: 'ok', durationMs: Date.now() - start }
          };
        } else {
          const err = lastError;
          return {
            artifacts: [],
            success: false,
            error: err,
            health: {
              name: collector.name,
              status,
              durationMs: Date.now() - start,
              errorMessage: String(err?.message ?? err),
              errorCode: err?.code
            }
          };
        }
      } finally {
        release();
      }
    };

    // Run all collectors with bounded concurrency
    const collectorPromises = collectors.map(runCollector);
    const results = await Promise.all(collectorPromises);

    return results;
  }

  private static runWithTimeout(collector: Collector, ctx: CollectorContext, timeoutMs: number): Promise<Artifact[]> {
    return new Promise((resolve, reject) => {
      let finished = false;
      const t = setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new CollectorTimeoutError(collector.name, timeoutMs));
      }, timeoutMs);

      collector.collect(ctx).then(
        (res) => { if (!finished) { finished = true; clearTimeout(t); resolve(res); } },
        (err) => { if (!finished) { finished = true; clearTimeout(t); reject(err); } }
      );
    });
  }

  static createHealthSummary(results: CollectorRunResult[]) {
    const summary = {
      totalCollectors: results.length,
      successful: results.filter(r => r.health.status === 'ok').length,
      partial: results.filter(r => r.health.status === 'partial').length,
      failed: results.filter(r => r.health.status === 'failed').length,
      timeout: results.filter(r => r.health.status === 'timeout').length,
      skipped: results.filter(r => r.health.status === 'skipped').length,
      totalExecutionTime: results.reduce((acc, r) => acc + (r.health.durationMs || 0), 0)
    };
    return summary;
  }

  static getFailedCollectorNames(results: CollectorRunResult[]): string[] {
    return results.filter(r => !r.success).map(r => r.health.name);
  }
}