const test = require('node:test');
const assert = require('node:assert/strict');
const { callRpc, acceptRpcReply, rpcReply } = require('./rpc.cjs');
function endpoint() {
  const value = { cbMap: new Map(), topicSet: new Set(), funcCallbackId: 0,
    getReplyTopic: subject => `reply_${subject}`, getCallTopic: subject => `call_${subject}`,
    subscibeTopic: async () => {}, client: {} };
  return value;
}
test('RPC registers before fast replies, shares subscription and preserves genuine zero/null results', async () => {
  const target = endpoint(); let subscribed = 0;
  target.subscibeTopic = async () => { subscribed++; };
  target.client.publish = (_topic, text) => {
    const request = JSON.parse(text);
    assert.ok(target.cbMap.has(request.callId));
    acceptRpcReply(target, { callId: request.callId, reason: 'fromFunction', result: request.param[0] });
  };
  assert.deepEqual(await Promise.all([0, null, false].map(v => callRpc(target, 'host', 'query', [v]))), [0, null, false]);
  assert.equal(subscribed, 1); assert.equal(target.cbMap.size, 0);
});
test('RPC serializes actual errors in both directions without resolving them as success', async () => {
  const target = endpoint();
  target.client.publish = async (_topic, text) => {
    const request = JSON.parse(text);
    acceptRpcReply(target, await rpcReply(request.callId, () => { throw Object.assign(new Error('PRIVATE'), { code: 'ERR_NITROSENSE_READ_ONLY' }); }));
  };
  await assert.rejects(callRpc(target, 'host', 'write', []), { code: 'ERR_NITROSENSE_READ_ONLY' });
  assert.equal(target.cbMap.size, 0);
});
test('RPC noImplement and duplicate/late replies cannot resolve a pending call twice', async () => {
  const target = endpoint();
  target.client.publish = (_topic, text) => {
    const request = JSON.parse(text);
    const reply = { callId: request.callId, reason: 'noImplement', result: '' };
    assert.equal(acceptRpcReply(target, reply), true);
    assert.equal(acceptRpcReply(target, reply), false);
  };
  await assert.rejects(callRpc(target, 'host', 'missing', []), { code: 'ERR_NITROSENSE_RPC_UNIMPLEMENTED' });
});
test('RPC deadlines clean callback state even when service never replies', async () => {
  const target = endpoint(); target.client.publish = () => {};
  await assert.rejects(callRpc(target, 'host', 'pending', [], { timeoutMs: 20 }), { code: 'ERR_NITROSENSE_RPC_TIMEOUT' });
  assert.equal(target.cbMap.size, 0);
});
test('RPC subscription failure is explicit and retry can subscribe again', async () => {
  const target = endpoint(); let fail = true;
  target.subscibeTopic = async () => { if (fail) throw new Error('subscription failed'); };
  target.client.publish = (_topic, text) => acceptRpcReply(target, { callId: JSON.parse(text).callId, reason: 'fromFunction', result: 3 });
  await assert.rejects(callRpc(target, 'host', 'first', []), { code: 'ERR_NITROSENSE_RPC_SUBSCRIBE' });
  assert.equal(target.cbMap.size, 0);
  fail = false; assert.equal(await callRpc(target, 'host', 'second', []), 3);
});
test('RPC can retry after a subscribe acknowledgement never arrives', async () => {
  const target = endpoint(); let calls = 0;
  target.subscibeTopic = () => ++calls === 1 ? new Promise(() => {}) : Promise.resolve();
  target.client.publish = (_topic, text) => acceptRpcReply(target, { callId: JSON.parse(text).callId, reason: 'fromFunction', result: 7 });
  await assert.rejects(callRpc(target, 'host', 'first', [], { timeoutMs: 20 }), { code: 'ERR_NITROSENSE_RPC_TIMEOUT' });
  assert.equal(await callRpc(target, 'host', 'second', []), 7);
  assert.equal(calls, 2);
});
test('RPC publish failure and queue limit cleanly reject without leaking callbacks', async () => {
  const target = endpoint(); target.client.publish = () => { throw new Error('publish failed'); };
  await assert.rejects(callRpc(target, 'host', 'first', []), { code: 'ERR_NITROSENSE_RPC_TRANSPORT' });
  assert.equal(target.cbMap.size, 0);
  target.client.publish = () => {};
  const first = assert.rejects(callRpc(target, 'host', 'pending', [], { timeoutMs: 20 }), { code: 'ERR_NITROSENSE_RPC_TIMEOUT' });
  await assert.rejects(callRpc(target, 'host', 'full', [], { maxPending: 1 }), { code: 'ERR_NITROSENSE_RPC_QUEUE_LIMIT' });
  await first;
});

test('RPC failure identifies the DDSC method locally without including private call arguments', async () => {
  const target = endpoint();
  target.client.publish = (_topic, text) => {
    const request = JSON.parse(text);
    acceptRpcReply(target, { callId: request.callId, reason: 'error', error: { code: 'EACCES' } });
  };
  await assert.rejects(callRpc(target, 'host', 'ddsc', ['info', 'getSystemUuid', ['PRIVATE_TOKEN']]), error => {
    assert.equal(error.operation, 'info.getSystemUuid');
    assert.match(error.message, /info\.getSystemUuid/);
    assert.doesNotMatch(error.stack, /PRIVATE_TOKEN/);
    return true;
  });
  await assert.rejects(callRpc(target, 'host', 'ddsc', ['PRIVATE_CATEGORY', 'PRIVATE_METHOD', []]), error => {
    assert.equal(error.operation, undefined);
    assert.doesNotMatch(error.message, /PRIVATE/);
    return true;
  });
});
