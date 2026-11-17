import { alertCountSeries } from './device-alerts.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatTime = value => {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date) : 'Time not recorded';
};
const formatDay = value => {
  const [year,month,day] = value.split('-').map(Number);
  const date = new Date(year,month-1,day);
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(date);
};
const trendLabels = {
  improving:'Readings closer to baseline',
  worsening:'Readings further from baseline',
  unchanged:'Readings remain similar',
  insufficient:'More readings needed',
};
const observationTrendLabels = {
  improving:'Fewer urgent signs reported',
  worsening:'Additional urgent signs reported',
  unchanged:'Same urgent signs reported',
  insufficient:'More observations needed',
};
const trendIcon = state => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${state === 'improving' ? 'M4 6 10 12 14 8 20 16M14 16h6v-6' : state === 'worsening' ? 'M4 18 10 12 14 16 20 8M14 8h6v6' : state === 'unchanged' ? 'M4 12h16m-5-5 5 5-5 5' : 'M12 5v7l4 2'}"/>${state === 'insufficient' ? '<circle cx="12" cy="12" r="9"/>' : ''}</svg>`;

export function renderDeviceAlerts(history = [], {now = new Date()} = {}) {
  const events = (Array.isArray(history) ? history : []).filter(entry => entry && ['watch','alert'].includes(entry.level) && Number.isFinite(new Date(entry.at).valueOf())).slice().sort((a,b) => new Date(b.at) - new Date(a.at));
  const series = alertCountSeries(events, {now,days:7});
  const total = series.reduce((sum,day) => sum + day.count, 0);
  const max = Math.max(1, ...series.map(day => day.count));
  const chart = `<figure class="card-alert-counts" aria-label="Alert count over the last seven days"><figcaption><span>Last 7 days</span><strong>${total} ${total === 1 ? 'alert' : 'alerts'}</strong></figcaption><div class="card-alert-bars">${series.map(day => `<div class="card-alert-day" role="img" aria-label="${esc(formatDay(day.date))}: ${day.count} ${day.count === 1 ? 'alert' : 'alerts'}"><span class="card-alert-number">${day.count}</span><span class="card-alert-track"><i style="height:${day.count / max * 100}%"></i></span><span class="card-alert-day-label">${esc(formatDay(day.date))}</span></div>`).join('')}</div></figure>`;
  return `<section class="card-device-alerts"><h3>Device alerts</h3><div class="glass card-alert-chart">${chart}</div>${events.length ? `<ol class="card-alert-timeline">${events.map(entry => {
    const state = Object.hasOwn(trendLabels,entry.trend?.state) ? entry.trend.state : 'insufficient';
    const trendLabel = (entry.source === 'owner' ? observationTrendLabels : trendLabels)[state];
    const trendTime = new Date(entry.trend?.at).valueOf();
    const hasFollowUp = Number.isFinite(trendTime) && trendTime > new Date(entry.at).valueOf();
    const risk = entry.risk || entry.title || 'Risk not recorded';
    const reason = entry.reason || 'Reason not recorded';
    return `<li class="card-alert-event is-${entry.level}"><article><header><time datetime="${esc(entry.at)}">${esc(formatTime(entry.at))}</time><span class="card-alert-source">${entry.source === 'owner' ? 'Owner reported' : 'Demo'}</span></header><div class="card-alert-level"><i aria-hidden="true"></i>${entry.level === 'alert' ? 'Urgent alert' : 'Watch alert'}</div><dl><div><dt>Potential risk</dt><dd class="card-alert-risk">${esc(risk)}</dd></div><div><dt>Reason</dt><dd>${esc(reason)}</dd></div></dl><div class="card-alert-trend is-${state}">${trendIcon(state)}<div><strong>${trendLabel}</strong>${entry.trend?.summary ? `<span>${esc(entry.trend.summary)}</span>` : ''}${hasFollowUp ? `<time class="card-alert-followup" datetime="${esc(entry.trend.at)}">Updated ${esc(formatTime(entry.trend.at))}</time>` : ''}</div></div></article></li>`;
  }).join('')}</ol>` : '<p class="card-empty">No alerts recorded.</p>'}</section>`;
}
