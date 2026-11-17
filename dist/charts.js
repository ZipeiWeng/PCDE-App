const number = new Intl.NumberFormat('en-GB');
const dateLabel = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

const metrics = [
  { key: 'heart', title: 'Heart rate', unit: 'bpm', color: 'heart', format: value => number.format(value), path: '<path d="M2 12h4l2-5 4 10 3-6 2 1h5"/>' },
  { key: 'temp', title: 'Skin temperature', unit: '°C', color: 'temp', format: value => value.toFixed(1), path: '<path d="M9 14.8V5a3 3 0 1 1 6 0v9.8a4 4 0 1 1-6 0Z"/><path d="M12 11v6"/>' },
  { key: 'steps', title: 'Daily steps', unit: 'steps', color: 'steps', format: value => number.format(value), path: '<path d="M7 13c-2 0-3-2-3-4 0-3 1-5 3-5s3 2 3 5c0 2-1 4-3 4Zm10 4c2 0 3-2 3-4 0-3-1-5-3-5s-3 2-3 5c0 2 1 4 3 4ZM6 16l1 3m10 1 1 2"/>' },
  { key: 'sleep', title: 'Estimated sleep', unit: 'hours', color: 'sleep', format: value => value.toFixed(1), path: '<path d="M20.9 13.3A9 9 0 0 1 10.7 3.1a9 9 0 1 0 10.2 10.2Z"/>' },
];

const plot = { left: 4, right: 336, top: 6, bottom: 74 };

function shortDate(date) {
  return dateLabel.format(new Date(`${date}T00:00:00Z`));
}

function scale(values, key) {
  const lower = Math.min(...values);
  const upper = Math.max(...values);
  const span = upper - lower;
  const increment = { heart: 2, temp: 0.2, steps: 200, sleep: 0.5 }[key];
  const padding = Math.max(span * 0.13, increment / 2);
  const min = Math.max(0, Math.floor((lower - padding) / increment) * increment);
  const max = Math.ceil((upper + padding) / increment) * increment;
  return { min, max: Math.max(min + increment, max) };
}

function renderMetric(metric, history) {
  const data = history.filter(day => Number.isFinite(day[metric.key]));
  if (!data.length) {
    return `<article class="paw-trend paw-trend--${metric.color}"><h3>${metric.title}</h3><p class="paw-chart-empty">No trend data yet</p></article>`;
  }

  const { min, max } = scale(data.map(day => day[metric.key]), metric.key);
  const points = data.map((day, index) => ({
    date: day.date,
    value: day[metric.key],
    x: data.length === 1 ? (plot.left + plot.right) / 2 : plot.left + index * (plot.right - plot.left) / (data.length - 1),
    y: plot.bottom - (day[metric.key] - min) * (plot.bottom - plot.top) / (max - min),
  }));
  const first = points[0];
  const latest = points.at(-1);
  const line = points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const area = `${first.x},${plot.bottom} ${line} ${latest.x},${plot.bottom}`;

  return `<article class="paw-trend paw-trend--${metric.color}">
    <header class="paw-trend__header">
      <div class="paw-trend__name"><span class="paw-trend__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${metric.path}</svg></span><h3>${metric.title}</h3></div>
      <div class="paw-trend__reading" data-reading aria-live="polite"><strong>${metric.format(latest.value)}</strong><span>${metric.unit}</span></div>
    </header>
    <div class="paw-trend__plot">
      <div class="paw-trend__scale" aria-hidden="true"><span>${metric.format(max)}</span><span>${metric.format(min)}</span></div>
      <div class="paw-trend__chart">
        <svg class="paw-trend__svg" viewBox="0 0 340 80" preserveAspectRatio="none" aria-hidden="true">
          <path class="paw-trend__gridlines" d="M4 6H336 M4 40H336 M4 74H336" vector-effect="non-scaling-stroke"/>
          <polygon class="paw-trend__area" points="${area}"/>
          <polyline class="paw-trend__line" points="${line}" vector-effect="non-scaling-stroke"/>
          <line class="paw-trend__cursor" x1="${latest.x}" y1="${plot.top}" x2="${latest.x}" y2="${plot.bottom}" vector-effect="non-scaling-stroke"/>
        </svg>
        ${points.map((point, index) => `<button type="button" class="paw-trend__point" data-point="${index}" data-x="${point.x}" style="--point-x:${point.x / 3.4}%;--point-y:${point.y / 0.8}%" data-value="${point.value}" aria-pressed="${index === points.length - 1}" aria-label="${shortDate(point.date)}, ${metric.title} ${metric.format(point.value)} ${metric.unit}" title="${shortDate(point.date)} · ${metric.format(point.value)} ${metric.unit}"><span></span></button>`).join('')}
      </div>
      <div class="paw-trend__dates" aria-hidden="true">${points.map((point, index) => `<span class="${index === points.length - 1 ? 'is-active' : ''}">${shortDate(point.date)}</span>`).join('')}</div>
    </div>
  </article>`;
}

function activateMetric(card, metric) {
  const reading = card.querySelector('[data-reading] strong');
  const cursor = card.querySelector('.paw-trend__cursor');
  const buttons = [...card.querySelectorAll('[data-point]')];
  const dates = [...card.querySelectorAll('.paw-trend__dates span')];
  if (!reading || !cursor || !buttons.length) return;

  function activate(button) {
    const x = button.dataset.x;
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
    reading.textContent = metric.format(Number(button.dataset.value));
    buttons.forEach(point => point.setAttribute('aria-pressed', String(point === button)));
    dates.forEach((date, index) => date.classList.toggle('is-active', index === Number(button.dataset.point)));
  }

  buttons.forEach(button => {
    button.addEventListener('click', () => activate(button));
    button.addEventListener('focus', () => activate(button));
  });
}

export function renderTrends(root, history = []) {
  const days = (Array.isArray(history) ? history : [])
    .filter(day => day && /^\d{4}-\d{2}-\d{2}$/.test(day.date) && Number.isFinite(Date.parse(`${day.date}T00:00:00Z`)))
    .slice(-7);
  root.innerHTML = `<div class="paw-trend-grid">${metrics.map(metric => renderMetric(metric, days)).join('')}</div>`;
  [...root.querySelectorAll('.paw-trend')].forEach((card, index) => activateMetric(card, metrics[index]));
}

function timeToMinutes(time) {
  if (time === '24:00') return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function duration(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes} min`;
  return `${hours} h${minutes ? ` ${minutes} min` : ''}`;
}

function normaliseSegments(segments) {
  const intervals = (Array.isArray(segments) ? segments : [])
    .filter(segment => segment && typeof segment.start === 'string' && typeof segment.end === 'string')
    .map(segment => ({ start: timeToMinutes(segment.start), end: timeToMinutes(segment.end) }))
    .filter(segment => Number.isFinite(segment.start) && segment.end > segment.start)
    .sort((first, second) => first.start - second.start);

  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && previous.end >= interval.start) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

export function renderSleep(root, segments = []) {
  const intervals = normaliseSegments(segments);
  const total = intervals.reduce((sum, segment) => sum + segment.end - segment.start, 0);

  root.innerHTML = `<div class="paw-sleep">
    <div class="paw-sleep__summary"><span><i></i>Estimated sleep periods</span><strong>${duration(total)} total</strong></div>
    <div class="paw-sleep__track" aria-hidden="true">
      ${intervals.map(({ start, end }) => `<div class="paw-sleep__interval" style="--start:${start / 14.4}%;--length:${(end - start) / 14.4}%"></div>`).join('')}
    </div>
    <div class="paw-sleep__axis" aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    ${intervals.length ? `<ul class="paw-sleep__segments" aria-label="Estimated sleep periods">${intervals.map(({ start, end }) => `<li><span>${minutesToTime(start)}–${minutesToTime(end)}</span><small>${duration(end - start)}</small></li>`).join('')}</ul>` : '<p class="paw-chart-empty">No estimated sleep periods for this day</p>'}
  </div>`;
}
