import { html, cx } from '../util/html.js';
import { icon } from './icons.js';
import { imageSrc } from '../proxy.js';
import { formatDate } from '../util/text.js';

const copyBtn = (value, label = 'Copy') =>
  html`<button class="iconbtn iconbtn--sm answer__copy" type="button" data-copy="${value}" aria-label="${label}" title="${label}">${icon('copy')}</button>`;

function card({ kind, caption = '', body, foot = '', copy = '', attrs = '' }) {
  return html`<section class="${cx('answer', `answer--${kind}`)}"${attrs}>
    ${copy}
    ${caption ? html`<p class="answer__caption">${caption}</p>` : ''}
    ${body}
    ${foot ? html`<p class="answer__foot">${foot}</p>` : ''}
  </section>`;
}

const cToF = (c) => (c * 9) / 5 + 32;
const temp = (c, imperial) => Math.round(imperial ? cToF(c) : c);
const weekday = (date, i) => (i === 0 ? 'Today' : new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }));

function weatherCard(a) {
  if (a.needsPlace) {
    return card({
      kind: 'weather',
      body: html`<p>Add a place to get a forecast, for example <a href="/search?q=weather+in+Berlin">weather in Berlin</a>. Cut doesn’t look up your location from your IP address.</p>`,
    });
  }
  const unit = a.imperial ? 'F' : 'C';
  const t = (c) => html`<span data-temp="${c}">${temp(c, a.imperial)}</span>`;
  return card({
    kind: 'weather',
    attrs: html` data-weather data-unit="${unit}"`,
    body: html`<div class="wx__head">
        <h3 class="wx__place">${a.place}</h3>
        <span class="wx__units" role="group" aria-label="Temperature unit"><button type="button" data-temp-unit="C" aria-pressed="${!a.imperial}">°C</button><button type="button" data-temp-unit="F" aria-pressed="${a.imperial}">°F</button></span>
      </div>
      <div class="wx__now">
        <span class="wx__icon">${icon(a.current.icon)}</span>
        <span class="wx__temp">${t(a.current.temp)}°</span>
        <span class="wx__cond">${a.current.condition}<br><span class="wx__detail">Feels like ${t(a.current.feels)}° · Humidity ${Math.round(a.current.humidity)}% · Wind <span data-wind="${a.current.wind}">${Math.round(a.imperial ? a.current.wind / 1.609 : a.current.wind)}</span> <span data-wind-unit>${a.imperial ? 'mph' : 'km/h'}</span></span></span>
      </div>
      <table class="wx__days">
        <tr>${a.days.map((d, i) => html`<th>${weekday(d.date, i)}</th>`)}</tr>
        <tr>${a.days.map((d) => html`<td title="${d.condition}">${icon(d.icon)}</td>`)}</tr>
        <tr>${a.days.map((d) => html`<td><b>${t(d.max)}°</b> ${t(d.min)}°</td>`)}</tr>
        <tr class="wx__rain">${a.days.map((d) => html`<td>${d.rain !== null ? `${d.rain}%` : ''}</td>`)}</tr>
      </table>`,
    foot: html`Forecast from <a href="https://open-meteo.com/" rel="noopener noreferrer">Open-Meteo</a>.`,
  });
}

export function answerCard(a) {
  switch (a.type) {
    case 'calc':
      return card({
        kind: 'calc',
        copy: copyBtn(a.result.replace(/,/g, ''), 'Copy result'),
        body: html`<p class="answer__sub mono">${a.expression} =</p><p class="answer__big">${a.result}</p>`,
      });
    case 'units':
      return card({
        kind: 'units',
        copy: copyBtn(a.to.value.replace(/,/g, ''), 'Copy result'),
        body: html`<p class="answer__sub">${a.from.value} ${a.from.unit} =</p><p class="answer__big">${a.to.value} <span class="answer__unit">${a.to.unit}</span></p>`,
        foot: a.rate,
      });
    case 'currency':
      return card({
        kind: 'currency',
        copy: copyBtn(a.to.amount.replace(/,/g, ''), 'Copy result'),
        body: html`<p class="answer__sub">${a.from.amount} ${a.from.code} (${a.from.name}) =</p><p class="answer__big">${a.to.amount} <span class="answer__unit">${a.to.code}</span></p>`,
        foot: html`1 ${a.from.code} = ${a.rate} ${a.to.code} · European Central Bank reference rate${a.date ? html`, ${formatDate(Date.parse(a.date))}` : ''}`,
      });
    case 'weather':
      return weatherCard(a);
    case 'clock':
      return card({
        kind: 'clock',
        caption: `Local time in ${a.place}`,
        attrs: html` data-clock="${a.timezone}"`,
        body: html`<p class="answer__big" data-clock-time>${a.time}</p><p class="answer__sub"><span data-clock-date>${a.date}</span> · ${a.offset}</p>`,
      });
    case 'define':
      return card({
        kind: 'define',
        body: html`<h3 class="dict__word">${a.word}</h3>
          ${a.meanings.map(
            (m) => html`<p class="dict__pos">${m.partOfSpeech}</p><ol class="dict__defs">${m.definitions.map((d) => html`<li>${d.text}${d.example ? html`<span class="dict__ex">“${d.example}”</span>` : ''}</li>`)}</ol>`,
          )}`,
        foot: html`From <a href="${a.url}" rel="noopener noreferrer">Wiktionary</a>`,
      });
    case 'color':
      return card({
        kind: 'color',
        body: html`<div class="color">
          <svg class="color__swatch" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="${a.hex}"/></svg>
          <table class="color__values">
            ${[['HEX', a.hex], ['RGB', a.rgb], ['HSL', a.hsl], ['CMYK', a.cmyk]].map(
              ([k, v]) => html`<tr><th>${k}</th><td class="mono">${v}</td><td><button class="linkbtn" type="button" data-copy="${v}">Copy</button></td></tr>`,
            )}
          </table>
        </div>`,
      });
    case 'code':
      return card({
        kind: 'code',
        caption: a.title,
        copy: copyBtn(a.output, 'Copy output'),
        body: html`<pre class="answer__code">${a.output}</pre>`,
      });
    case 'uuid':
      return card({
        kind: 'uuid',
        caption: 'Random UUID (version 4)',
        copy: copyBtn(a.value, 'Copy UUID'),
        body: html`<p class="answer__big mono" data-gen-out>${a.value}</p><p><button class="btn btn--sm" type="button" data-regen="uuid">Generate another</button></p>`,
      });
    case 'password':
      return card({
        kind: 'password',
        caption: 'Random password, generated in your browser',
        attrs: html` data-password data-length="${a.length}"`,
        copy: html`<button class="iconbtn iconbtn--sm answer__copy" type="button" data-copy-from="[data-gen-out]" aria-label="Copy password" title="Copy password">${icon('copy')}</button>`,
        body: html`<p class="answer__big mono answer__wrap" data-gen-out>&nbsp;</p>
          <noscript><p>Enable JavaScript to generate a password. Cut never generates passwords on its server.</p></noscript>
          <div class="pwopts">
            <label>Length <input type="range" min="8" max="64" value="${Math.min(a.length, 64)}" data-pw-length> <output data-pw-length-out>${Math.min(a.length, 64)}</output></label>
            <label><input type="checkbox" data-pw-symbols checked> Symbols</label>
            <label><input type="checkbox" data-pw-ambiguous> Avoid look-alike characters</label>
            <button class="btn btn--sm" type="button" data-regen="password">Generate another</button>
          </div>`,
      });
    case 'coin':
      return card({
        kind: 'coin',
        caption: 'Coin flip',
        body: html`<p class="answer__big" data-gen-out>${a.value}</p><p><button class="btn btn--sm" type="button" data-regen="coin">Flip again</button></p>`,
      });
    case 'dice':
      return card({
        kind: 'dice',
        caption: `${a.count} × d${a.sides}`,
        attrs: html` data-dice data-count="${a.count}" data-sides="${a.sides}"`,
        body: html`<p class="dice" data-dice-faces>${a.rolls.map((r) => html`<span class="die">${r}</span>`)}</p>
          ${a.count > 1 ? html`<p class="answer__sub">Total: <b data-dice-total>${a.total}</b></p>` : ''}
          <p><button class="btn btn--sm" type="button" data-regen="dice">Roll again</button></p>`,
      });
    case 'random':
      return card({
        kind: 'random',
        caption: `Random number between ${a.lo} and ${a.hi}`,
        attrs: html` data-random data-lo="${a.lo}" data-hi="${a.hi}"`,
        body: html`<p class="answer__big" data-gen-out>${a.value.toLocaleString('en-US')}</p><p><button class="btn btn--sm" type="button" data-regen="random">Again</button></p>`,
      });
    case 'stopwatch':
      return card({
        kind: 'stopwatch',
        caption: 'Stopwatch',
        attrs: html` data-stopwatch`,
        body: html`<div class="watch"><p class="answer__big mono" data-watch-time>00:00.00</p>
          <p class="watch__btns"><button class="btn btn--sm" type="button" data-watch-start>Start</button> <button class="btn btn--sm" type="button" data-watch-lap disabled>Lap</button> <button class="btn btn--sm" type="button" data-watch-reset>Reset</button></p>
          <ol class="watch__laps" data-watch-laps></ol>
          <noscript><p>The stopwatch needs JavaScript.</p></noscript></div>`,
      });
    case 'timer': {
      const mm = String(Math.floor(a.seconds / 60)).padStart(2, '0');
      const ss = String(a.seconds % 60).padStart(2, '0');
      return card({
        kind: 'timer',
        caption: 'Timer',
        attrs: html` data-timer data-seconds="${a.seconds}"`,
        body: html`<div class="watch"><p class="answer__big mono" data-timer-time>${a.seconds >= 3600 ? `${Math.floor(a.seconds / 3600)}:` : ''}${mm}:${ss}</p>
          <p class="watch__btns"><button class="btn btn--sm" type="button" data-timer-start>Start</button> <button class="btn btn--sm" type="button" data-timer-add="60">+1 min</button> <button class="btn btn--sm" type="button" data-timer-reset>Reset</button></p>
          <noscript><p>The timer needs JavaScript.</p></noscript></div>`,
      });
    }
    case 'lorem':
      return card({
        kind: 'lorem',
        caption: 'Lorem ipsum',
        copy: copyBtn(a.paragraphs.join('\n\n'), 'Copy text'),
        body: html`<div class="lorem">${a.paragraphs.map((p) => html`<p>${p}</p>`)}</div>`,
      });
    case 'timestamp':
      return a.live
        ? card({
            kind: 'timestamp',
            caption: 'Current Unix timestamp (seconds since 1 January 1970 UTC)',
            attrs: html` data-epoch`,
            copy: copyBtn(String(a.value), 'Copy timestamp'),
            body: html`<p class="answer__big mono" data-epoch-out>${a.value}</p>`,
          })
        : card({
            kind: 'timestamp',
            caption: `Unix timestamp ${a.value}`,
            copy: copyBtn(a.iso, 'Copy ISO date'),
            body: html`<p class="answer__big">${a.utc}</p><p class="answer__sub mono">${a.iso}</p>`,
          });
    default:
      return '';
  }
}

export function infoboxView(box, ctx) {
  const target = ctx.prefs.newTab ? html` target="_blank"` : '';
  const img = box.image && ctx.fx.thumbnails ? imageSrc(box.image, ctx) : '';
  const rel = ctx.prefs.referrer === 'origin' ? 'noopener' : 'noopener noreferrer';
  return html`<article class="infobox">
    ${img ? html`<div class="${cx('infobox__media', box.logo && 'infobox__media--logo')}"><img src="${img}" alt="" loading="lazy" decoding="async"></div>` : ''}
    <h2 class="infobox__title">${box.title}</h2>
    ${box.subtitle ? html`<p class="infobox__subtitle">${box.subtitle}</p>` : ''}
    <p class="infobox__text">${box.description} ${box.url ? html`<a href="${box.url}" rel="${rel}"${target}>${box.source}</a>` : ''}</p>
    ${box.facts.length ? html`<table class="infobox__facts">${box.facts.map(([k, v]) => html`<tr><th>${k}</th><td>${v}</td></tr>`)}</table>` : ''}
    ${box.links.length
      ? html`<p class="infobox__links">${box.links.map(([name, url], i) => html`${i ? ' · ' : ''}<a href="${url}" rel="${rel}"${target}>${name}</a>`)}</p>`
      : ''}
  </article>`;
}
