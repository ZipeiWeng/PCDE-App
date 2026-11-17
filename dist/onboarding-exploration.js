// The last scene introduces Activity fully before unlocking Companion.
export function advanceExploration(progress,page,{activityReviewed=false}={}) {
  if(progress===0&&page===0)return 1;
  if(progress===1&&page===2&&activityReviewed)return 2;
  return progress;
}
export function canExplorePage(progress,page,{activityReviewed=false}={}) {
  if(progress>=2)return true;
  return progress===0 ? page===0 : activityReviewed&&page===2;
}
export function explorationComplete(progress,page) {
  return progress>=2&&page===2;
}

// DOM scroll measurements can be fractional; a small tolerance accommodates
// subpixel rounding and touch scrolling without requiring an exact equality.
export function activityScrollComplete({scrollTop,scrollHeight,clientHeight}={},tolerance=12) {
  if(![scrollTop,scrollHeight,clientHeight].every(Number.isFinite)||scrollHeight<=0||clientHeight<=0)return false;
  const threshold=Number.isFinite(tolerance)?Math.max(0,tolerance):12;
  const remaining=Math.max(0,scrollHeight-clientHeight);
  return remaining===0 || Math.max(0,scrollTop)>=remaining-threshold;
}
