import { finished } from 'node:stream/promises';
import { WebSocket } from 'ws';
function dimension(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000 ? value : fallback;
}
function decode(data) {
    return (Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)).toString('utf8');
}
/** 将页面连接绑定到 DSH 的托管 PTY；关闭页面及插件卸载都会等待终端清理。 */
export async function connectTerminal(ws, runtime, options) {
    const abort = new AbortController();
    let handle;
    let closed = false;
    let cols = dimension(options.cols, 80);
    let rows = dimension(options.rows, 24);
    let operations = Promise.resolve();
    let resolveClose;
    const closing = new Promise(resolve => { resolveClose = () => resolve(null); });
    let rejectFailure;
    const failure = new Promise((_, reject) => { rejectFailure = reject; });
    // A transport can fail while terminal allocation is still in flight.
    void failure.catch(() => { });
    const send = (type, data = {}) => {
        if (ws.readyState !== WebSocket.OPEN)
            return;
        if (options.protocol === 'json')
            ws.send(JSON.stringify({ type, ...data }));
        else if (type === 'output')
            ws.send(String(data.data));
        else if (type === 'error')
            ws.send(`\r\n[终端启动失败：${data.message}]\r\n`);
    };
    const close = () => {
        closed = true;
        abort.abort();
        resolveClose();
    };
    const shutdown = () => {
        close();
        if (ws.readyState === WebSocket.OPEN)
            ws.close(1001, 'plugin unloaded');
    };
    const transportError = (error) => {
        abort.abort();
        rejectFailure(error);
    };
    const enqueue = (operation) => {
        operations = operations.then(() => closed ? undefined : operation());
        void operations.catch(error => rejectFailure(error));
    };
    const message = (data) => {
        if (closed)
            return;
        const text = decode(data);
        if (options.protocol !== 'json') {
            if (handle)
                enqueue(() => handle.write(text));
            return;
        }
        let value;
        try {
            value = JSON.parse(text);
        }
        catch {
            return;
        }
        if (value?.type === 'resize') {
            cols = dimension(value.cols, cols);
            rows = dimension(value.rows, rows);
            if (handle) {
                const size = { cols, rows };
                enqueue(() => handle.resize(size.cols, size.rows));
            }
        }
        else if (value?.type === 'input' && typeof value.data === 'string' && handle) {
            enqueue(() => handle.write(value.data));
        }
    };
    ws.on('close', close);
    ws.on('error', transportError);
    ws.on('message', message);
    options.signal?.addEventListener('abort', shutdown, { once: true });
    if (options.signal?.aborted || ws.readyState !== WebSocket.OPEN)
        close();
    try {
        const executable = await runtime.resolveExecutable('kubectl', undefined, abort.signal);
        if (closed)
            return;
        const argv = [executable, 'exec', '-it', options.pod, '-n', options.namespace];
        if (options.container)
            argv.push('-c', options.container);
        argv.push('--', '/bin/sh');
        handle = await runtime.spawnTerminal({
            argv, cwd: process.cwd(), env: { KUBECONFIG: options.kubeconfig },
            cols, rows, terminalType: 'xterm-256color', graceMs: 1000, signal: abort.signal,
        });
        // Providers may finish allocation at the same time as cancellation.
        void handle.done.catch(() => { });
        if (closed || abort.signal.aborted)
            return;
        handle.output.setEncoding('utf8');
        handle.output.on('data', data => send('output', { data: String(data) }));
        handle.output.on('error', transportError);
        await handle.resize(cols, rows);
        if (closed)
            return;
        send('ready');
        const outcome = await Promise.race([handle.done, closing, failure]);
        if (outcome && !closed) {
            // Drain all queued UTF-8 output before sending the final exit frame.
            await Promise.race([finished(handle.output), closing, failure]);
            if (!closed) {
                send('exit', { code: outcome.exitCode, signal: outcome.signal });
                ws.close(1000, `exit ${outcome.exitCode ?? outcome.signal ?? 'unknown'}`);
            }
        }
    }
    catch (error) {
        if (!closed) {
            send('error', { message: String(error?.message || error) });
            if (ws.readyState === WebSocket.OPEN)
                ws.close(1011, 'terminal failed');
        }
    }
    finally {
        close();
        options.signal?.removeEventListener('abort', shutdown);
        ws.off('close', close);
        ws.off('message', message);
        // Retain the error listener until the socket closes to avoid late unhandled errors.
        if (ws.readyState === WebSocket.CLOSED)
            ws.off('error', transportError);
        await handle?.terminate();
        await operations.catch(() => { });
    }
}
