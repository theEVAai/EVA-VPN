'use strict';
/**
 * Журнал на диск. Без него любая жалоба «перестало работать» неразбираема:
 * ядро пишет в stdout, приложение держало это только в памяти и теряло
 * при перезапуске.
 *
 * Пишем синхронно: журнал нужен именно тогда, когда приложение убили жёстко,
 * а буферизованный поток в этот момент теряет последние строки — самые важные.
 */

const fs = require('fs');
const path = require('path');

const KEEP_FILES = 10;
const MAX_BYTES = 8 * 1024 * 1024;

class LogFile {
  constructor(dir) {
    this.dir = path.join(dir, 'logs');
    this.file = null;
    this.bytes = 0;
    this.open();
  }

  open() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.rotate();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      this.file = path.join(this.dir, 'eva-' + stamp + '.log');
      this.bytes = 0;
      this.write('=== запуск приложения ===');
    } catch (e) {
      console.error('logfile.open', e);
      this.file = null;
    }
  }

  /** Оставляем последние KEEP_FILES журналов, остальное удаляем. */
  rotate() {
    try {
      const files = fs
        .readdirSync(this.dir)
        .filter((f) => f.startsWith('eva-') && f.endsWith('.log'))
        .sort();
      while (files.length >= KEEP_FILES) {
        const old = files.shift();
        fs.rmSync(path.join(this.dir, old), { force: true });
      }
    } catch { /* каталог мог только что появиться */ }
  }

  write(line) {
    if (!this.file) return;
    const stamp = new Date().toISOString().slice(11, 23);
    const text = '[' + stamp + '] ' + String(line) + '\n';
    this.bytes += Buffer.byteLength(text);

    if (this.bytes > MAX_BYTES) {
      // не даём одному сеансу съесть диск: начинаем файл заново
      this.file = null;
      this.open();
      return;
    }

    try {
      fs.appendFileSync(this.file, text, 'utf8');
    } catch { /* диск мог отвалиться — журнал не повод падать */ }
  }

  close() {
    this.write('=== выход ===');
    this.file = null;
  }
}

module.exports = { LogFile };
