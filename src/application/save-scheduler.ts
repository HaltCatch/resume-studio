/**
 * 防抖 + 串行化的保存调度器。
 * markDirty 重置防抖计时；flush 立即冲刷并等待在途保存；
 * 保存失败时恢复脏标记，等待下一次触发。
 */
export class SaveScheduler {
  private timer: number | undefined;
  private chain: Promise<void> = Promise.resolve();
  private dirtyFlag = false;

  constructor(private readonly options: {
    delayMs: number;
    save: () => Promise<void>;
    onError?: (error: unknown) => void;
  }) {}

  get dirty(): boolean {
    return this.dirtyFlag;
  }

  markDirty(): void {
    this.dirtyFlag = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.flush(); }, this.options.delayMs);
  }

  /** 切换文档时调用：丢弃未保存状态与防抖计时器。 */
  reset(): void {
    window.clearTimeout(this.timer);
    this.dirtyFlag = false;
  }

  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (this.dirtyFlag) {
      this.dirtyFlag = false;
      this.chain = this.chain
        .then(() => this.options.save())
        .catch((error) => {
          this.dirtyFlag = true;
          this.options.onError?.(error);
        });
    }
    await this.chain;
  }
}
