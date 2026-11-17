export const isDemoAccount = account => account?.demo === true || account?.isTest === true;
export const hasCurrentReadings = snapshot => ['heart','temp','steps','sleep'].every(key => Number.isFinite(snapshot?.[key]));
export const hasHealthScore = snapshot => Number.isFinite(snapshot?.score) && snapshot?.status !== 'unknown';
export function emptyReadingLabel({connected=false,zh=false}={}) {
  return connected ? (zh?'等待首次读数':'Waiting for first readings') : (zh?'连接设备，开始监测':'Connect a collar to begin');
}
