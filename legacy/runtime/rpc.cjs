// Shared by the Electron main process and its Node-enabled original renderer.
// No transport details or raw exception messages cross the UI boundary.
const subscriptions = new WeakMap();
function rpcError(code, operation) {
  return Object.assign(new Error(`NitroSense operation failed (${code}${operation ? '; ' + operation : ''})`),
    { code }, operation ? { operation } : {});
}
function operationName(fnName, args) {
  // DDSC routing names only; never include call arguments or service messages.
  if (fnName !== 'ddsc' || !['info', 'util', 'pssdk'].includes(args?.[0]) ||
      typeof args?.[1] !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(args[1])) return undefined;
  return args[0] + '.' + args[1];
}
async function rpcReply(callId, invoke) {
  try { return { callId, reason: 'fromFunction', result: await invoke() }; }
  catch (error) {
    return { callId, reason: 'error', result: null, error: {
      code: typeof error?.code === 'string' ? error.code : 'ERR_NITROSENSE_OPERATION',
      ...(typeof error?.request === 'string' ? { request: error.request } : {}),
      ...(Number.isInteger(error?.result) ? { result: error.result } : {}),
    } };
  }
}
function acceptRpcReply(endpoint, response) {
  const pending = endpoint.cbMap.get(response.callId);
  if (!pending) return false;
  endpoint.cbMap.delete(response.callId); clearTimeout(pending.timer);
  if (response.reason === 'fromFunction') pending.resolve(response.result);
  else {
    const error = rpcError(response.reason === 'error' && typeof response.error?.code === 'string' ? response.error.code : 'ERR_NITROSENSE_RPC_UNIMPLEMENTED', pending.operation);
    if (typeof response.error?.request === 'string') error.request = response.error.request;
    if (Number.isInteger(response.error?.result)) error.result = response.error.result;
    pending.reject(error);
  }
  return true;
}
function subscribeReply(endpoint, subject) {
  let topics = subscriptions.get(endpoint);
  if (!topics) { topics = new Map(); subscriptions.set(endpoint, topics); }
  const topic = endpoint.getReplyTopic(subject);
  if (topics.has(topic)) return topics.get(topic).promise;
  if (endpoint.topicSet.has(topic)) return Promise.resolve();
  endpoint.topicSet.add(topic);
  const record = { pending: true };
  record.promise = Promise.resolve().then(() => endpoint.subscibeTopic(topic)).catch(error => {
    if (topics.get(topic) === record) { endpoint.topicSet.delete(topic); topics.delete(topic); }
    throw error;
  }).finally(() => { record.pending = false; });
  topics.set(topic, record);
  return record.promise;
}
function callRpc(endpoint, subject, fnName, args, { timeoutMs = 10000, maxPending = 256 } = {}) {
  if (endpoint.cbMap.size >= maxPending) return Promise.reject(rpcError('ERR_NITROSENSE_RPC_QUEUE_LIMIT'));
  return new Promise((resolve, reject) => {
    const callId = String(endpoint.funcCallbackId++);
    const fail = code => {
      const pending = endpoint.cbMap.get(callId);
      if (!pending) return;
      endpoint.cbMap.delete(callId); clearTimeout(pending.timer); reject(rpcError(code, pending.operation));
      if (code === 'ERR_NITROSENSE_RPC_TIMEOUT') {
        const topic = endpoint.getReplyTopic(subject), topics = subscriptions.get(endpoint);
        if (topics?.get(topic)?.pending) { topics.delete(topic); endpoint.topicSet.delete(topic); }
      }
    };
    const timer = setTimeout(() => fail('ERR_NITROSENSE_RPC_TIMEOUT'), timeoutMs);
    // Register before publish: a synchronous/fast reply cannot race registration.
    endpoint.cbMap.set(callId, { resolve, reject, timer, operation: operationName(fnName, args) });
    let ready;
    try { ready = subscribeReply(endpoint, subject); }
    catch { fail('ERR_NITROSENSE_RPC_SUBSCRIBE'); return; }
    ready.then(() => {
      if (!endpoint.cbMap.has(callId)) return;
      try {
        endpoint.client.publish(endpoint.getCallTopic(subject), JSON.stringify({ callId, fnName, param: args }), error => {
          if (error) fail('ERR_NITROSENSE_RPC_TRANSPORT');
        });
      } catch { fail('ERR_NITROSENSE_RPC_TRANSPORT'); }
    }, () => fail('ERR_NITROSENSE_RPC_SUBSCRIBE'));
  });
}
module.exports = { rpcReply, acceptRpcReply, callRpc };
