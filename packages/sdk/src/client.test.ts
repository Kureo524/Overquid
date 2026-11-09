import { describe, expect, it } from 'vitest';
import { createClient, OverquidError, type Transport } from './client';
import type { CallMessage } from './protocol';

/** A fake host: records calls, lets the test answer and send events. */
function fakeHost() {
  const sent: CallMessage[] = [];
  let deliver: (data: unknown) => void = () => undefined;
  const transport: Transport = {
    post: (message) => sent.push(message),
    listen: (handler) => {
      deliver = handler;
    },
  };
  return {
    transport,
    sent,
    reply: (id: number, body: { result?: unknown; error?: string }) =>
      deliver({ overquid: 1, id, ...body }),
    event: (event: 'show' | 'hide') => deliver({ overquid: 1, event }),
    raw: (data: unknown) => deliver(data),
  };
}

describe('calls', () => {
  it('sends tagged calls with increasing ids and resolves on reply', async () => {
    const host = fakeHost();
    const client = createClient(host.transport);
    const first = client.call('echo', { a: 1 });
    const second = client.call('echo');
    expect(host.sent).toEqual([
      { overquid: 1, id: 1, method: 'echo', args: { a: 1 } },
      { overquid: 1, id: 2, method: 'echo', args: undefined },
    ]);
    host.reply(2, { result: 'two' });
    host.reply(1, { result: 'one' });
    await expect(first).resolves.toBe('one');
    await expect(second).resolves.toBe('two');
  });

  it('rejects with an OverquidError on error replies', async () => {
    const host = fakeHost();
    const promise = createClient(host.transport).call('storage.get', { key: 'x' });
    host.reply(1, { error: "permission 'storage' is not in the manifest" });
    await expect(promise).rejects.toBeInstanceOf(OverquidError);
    await expect(promise).rejects.toThrow("permission 'storage'");
  });

  it('ignores untagged or unknown messages', async () => {
    const host = fakeHost();
    const promise = createClient(host.transport).call('echo');
    host.raw({ id: 1, result: 'forged' });
    host.raw('noise');
    host.reply(99, { result: 'unknown id' });
    host.reply(1, { result: 'real' });
    await expect(promise).resolves.toBe('real');
  });
});

describe('storage', () => {
  it('maps to storage.* calls', async () => {
    const host = fakeHost();
    const { storage } = createClient(host.transport);
    const missing = storage.get('count');
    host.reply(1, { result: null });
    await expect(missing).resolves.toBeUndefined();
    const set = storage.set('count', 3);
    host.reply(2, { result: null });
    await set;
    expect(host.sent.map(({ method, args }) => [method, args])).toEqual([
      ['storage.get', { key: 'count' }],
      ['storage.set', { key: 'count', value: 3 }],
    ]);
  });
});

describe('notify', () => {
  it('maps to the notify call', async () => {
    const host = fakeHost();
    const shown = createClient(host.transport).notify({ title: 'Break', body: '5 min' });
    host.reply(1, { result: null });
    await shown;
    expect(host.sent[0]).toMatchObject({
      method: 'notify',
      args: { title: 'Break', body: '5 min' },
    });
  });
});

describe('lifecycle', () => {
  it('tracks visibility and calls listeners until unsubscribed', () => {
    const host = fakeHost();
    const client = createClient(host.transport);
    const seen: string[] = [];
    const stopShow = client.onShow(() => seen.push('show'));
    client.onHide(() => seen.push('hide'));
    expect(client.visible).toBe(false);
    host.event('show');
    expect(client.visible).toBe(true);
    host.event('hide');
    stopShow();
    host.event('show');
    expect(seen).toEqual(['show', 'hide']);
  });
});
