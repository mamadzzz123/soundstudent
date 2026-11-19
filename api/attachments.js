'use strict';

const { readLetters, writeAttachment, readAttachment, StoreError } = require('../lib/github-store');
const { sendJson, readBody, errorResponse, methodNotAllowed } = require('../lib/http');

const MAX_FILES = 5;
const MAX_FILE_SIZE = 2.5 * 1024 * 1024;

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const input = await readBody(req);
      const letterId = String(input.letterId || '').trim();
      const index = Number(input.index);
      const name = String(input.name || 'attachment').slice(0, 240);
      const type = String(input.type || 'application/octet-stream').slice(0, 120);
      const size = Number(input.size) || 0;
      const dataBase64 = String(input.dataBase64 || '');

      if (!/^[a-zA-Z0-9-]{1,100}$/.test(letterId)) throw new StoreError('شناسه پیام معتبر نیست.', 400);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_FILES) throw new StoreError('شماره پیوست نامعتبر است.', 400);
      if (size < 0 || size > MAX_FILE_SIZE) throw new StoreError('حجم هر فایل باید حداکثر ۲٫۵ مگابایت باشد.', 400);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) throw new StoreError('محتوای فایل معتبر نیست.', 400);

      const bytes = Buffer.from(dataBase64, 'base64');
      if (bytes.length !== size) throw new StoreError('محتوای فایل با اندازه اعلام‌شده مطابقت ندارد.', 400);

      await writeAttachment(letterId, index, bytes);
      return sendJson(res, 201, { ok: true, attachment: { index, name, type, size } });
    }

    if (req.method === 'GET') {
      const letterId = String((req.query && req.query.letterId) || '').trim();
      const index = Number(req.query && req.query.index);
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(letterId)) throw new StoreError('شناسه پیام معتبر نیست.', 400);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_FILES) throw new StoreError('شماره پیوست نامعتبر است.', 400);

      const letters = await readLetters();
      const letter = letters.find((item) => item.id === letterId);
      if (!letter) throw new StoreError('پیام مربوط به این پیوست پیدا نشد.', 404);
      const attachment = (letter.attachments || []).find((item, position) => Number(item.index ?? position) === index);
      if (!attachment) throw new StoreError('این پیوست پیدا نشد.', 404);

      const bytes = await readAttachment(letterId, index);
      if (!bytes) throw new StoreError('فایل پیوست در مخزن پیدا نشد.', 404);

      const filenameFallback = String(attachment.name || 'attachment').replace(/[\r\n"\\]/g, '_').replace(/[^\x20-\x7E]/g, '_');
      const disposition = req.query && req.query.download === '1' ? 'attachment' : 'inline';
      res.statusCode = 200;
      res.setHeader('Content-Type', attachment.type || 'application/octet-stream');
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Content-Disposition', `${disposition}; filename="${filenameFallback}"; filename*=UTF-8''${encodeURIComponent(attachment.name || 'attachment')}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.end(bytes);
    }

    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    return errorResponse(res, error);
  }
};
