import { WebSocket } from 'ws';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
export interface TerminalOptions {
    kubeconfig: string;
    namespace: string;
    pod: string;
    container?: string;
    cols?: number;
    rows?: number;
    protocol?: 'raw' | 'json';
    signal?: AbortSignal;
}
/** 将页面连接绑定到 DSH 的托管 PTY；关闭页面及插件卸载都会等待终端清理。 */
export declare function connectTerminal(ws: WebSocket, runtime: SubprocessRuntime, options: TerminalOptions): Promise<void>;
//# sourceMappingURL=terminal.d.ts.map