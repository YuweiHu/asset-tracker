/* ===== 自訂下拉元件（取代原生 select，桌機/iOS 外觀一致）===== */
import { svgIcon } from './icons.js';

export class Dropdown {
  constructor(mountId, options, onChange) {
    this.options = options;
    this.onChange = onChange;
    this.value = options[0].value;
    this.el = document.getElementById(mountId);
    this.el.classList.add('dropdown');
    this.el.innerHTML =
      `<button type="button" class="dd-toggle"><span class="dd-label"></span><span class="dd-chev">${svgIcon('chevron-down', 16)}</span></button>` +
      '<div class="dd-menu">' +
      options.map(o => `<div class="dd-item" data-value="${o.value}">${o.label}</div>`).join('') +
      '</div>';
    this.labelEl = this.el.querySelector('.dd-label');
    this.el.querySelector('.dd-toggle').addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    this.el.querySelectorAll('.dd-item').forEach(it =>
      it.addEventListener('click', e => { e.stopPropagation(); this.set(it.dataset.value); this.close(); }));
    document.addEventListener('click', () => this.close());
    this.set(this.value, true);
  }
  toggle() {
    const willOpen = !this.el.classList.contains('open');
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    if (willOpen) this.el.classList.add('open');
  }
  close() { this.el.classList.remove('open'); }
  set(v, silent) {
    this.value = v;
    const opt = this.options.find(o => o.value === v) || this.options[0];
    this.labelEl.textContent = opt.label;
    this.el.querySelectorAll('.dd-item').forEach(it => it.classList.toggle('active', it.dataset.value === v));
    if (!silent && this.onChange) this.onChange(v);
  }
}
