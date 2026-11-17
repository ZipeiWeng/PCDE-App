// Bluetooth transport only. Sensor services are intentionally not guessed.
export function createDeviceConnection({ bluetooth, secureContext = true, onChange = () => {}, timeoutMs = 15000 } = {}) {
  let device = null, generation = 0, destroyed = false;
  let state = { status: 'idle', name: '', error: '', disconnection: '', supported: Boolean(secureContext && bluetooth?.requestDevice), secureContext };
  const snapshot = () => ({ ...state });
  const update = next => { state = { ...state, ...next }; if (!destroyed) onChange(snapshot()); };
  const release = () => {
    if (!device) return;
    device.removeEventListener?.('gattserverdisconnected', onDisconnected);
    if (device.gatt?.connected) device.gatt.disconnect();
    device = null;
  };
  function onDisconnected() { update({ status: 'disconnected', error: '', disconnection: 'lost' }); }
  function cancelPending() {
    if (!['requesting', 'connecting'].includes(state.status)) return;
    generation++; release(); update({ status: 'idle', name: '', error: '', disconnection: '' });
  }
  async function connect() {
    if (destroyed || ['requesting', 'connecting', 'connected'].includes(state.status)) return snapshot();
    if (!state.supported) { update({ status: 'unsupported', error: secureContext ? 'unsupported' : 'insecure' }); return snapshot(); }
    const request = ++generation;
    release(); update({ status: 'requesting', name: '', error: '', disconnection: '' });
    let selected, timer;
    try {
      // Called directly from a click so the browser retains user activation.
      selected = await bluetooth.requestDevice({ filters: [{ namePrefix: 'Pawprint' }] });
      if (request !== generation || destroyed) return snapshot();
      if (!selected.gatt) throw Object.assign(new Error('No GATT transport'), { name: 'NotSupportedError' });
      device = selected;
      device.addEventListener?.('gattserverdisconnected', onDisconnected);
      update({ status: 'connecting', name: selected.name || 'Pawprint device' });
      const connection = selected.gatt.connect();
      // A cancelled or timed-out connection must not remain connected later.
      connection.then(() => { if ((request !== generation || destroyed) && selected.gatt.connected) selected.gatt.disconnect(); }, () => {});
      await Promise.race([connection, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Connection timed out'), { name: 'TimeoutError' })), timeoutMs);
      })]);
      if (request !== generation || destroyed) return snapshot();
      if (!selected.gatt.connected) throw Object.assign(new Error('Device disconnected'), { name: 'NetworkError' });
      update({ status: 'connected', error: '', disconnection: '' });
    } catch (error) {
      if (request !== generation || destroyed) return snapshot();
      generation++; release();
      const code = error?.name === 'NotFoundError' ? 'cancelled'
        : error?.name === 'SecurityError' || error?.name === 'NotAllowedError' ? 'permission'
        : error?.name === 'TimeoutError' ? 'timeout'
        : error?.name === 'NotSupportedError' ? 'unsupported' : 'connection';
      update({ status: code === 'cancelled' ? 'idle' : 'error', error: code });
    } finally { clearTimeout(timer); }
    return snapshot();
  }
  function disconnect() { generation++; release(); update({ status: 'disconnected', name: '', error: '', disconnection: 'manual' }); }
  function demo() { generation++; release(); update({ status: 'demo', name: 'Pawprint One', error: '', disconnection: '' }); }
  function destroy() { destroyed = true; generation++; release(); }
  return { getState: snapshot, connect, disconnect, demo, cancelPending, destroy };
}
