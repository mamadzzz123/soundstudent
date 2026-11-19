'use strict';

const { readLetters, modifyLetters, StoreError } = require('../lib/github-store');
const { sendJson, readBody, errorResponse, methodNotAllowed } = require('../lib/http');

const MAX_FILES = 5;
const MAX_FILE_SIZE = 2.5 * 1024 * 1024;
const MAX_TOTAL_FILE_SIZE = 12.5 * 1024 * 1024;

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const letters = await readLetters();
      letters.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJson(res, 200, letters.map((letter) => ({
        ...letter,
        attachments: (letter.attachments || []).map(({ dataBase64, ...metadata }) => metadata)
      })));
    }

    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

    const input = await readBody(req);
    const id = String(input.id || '').trim();
    const message = String(input.message || '').trim();
    const attachments = Array.isArray(input.attachments) ? input.attachments : [];

    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new StoreError('شناسه پیام معتبر نیست.', 400);
    if (!message) throw new StoreError('متن پیام نمی‌تواند خالی باشد.', 400);
    if (attachments.length > MAX_FILES) throw new StoreError(`حداکثر ${MAX_FILES} فایل مجاز است.`, 400);

    let totalBytes = 0;
    const normalizedAttachments = attachments.map((file, position) => {
      const index = Number.isInteger(Number(file.index)) ? Number(file.index) : position;
      const size = Number(file.size) || 0;
      if (index < 0 || index >= MAX_FILES) throw new StoreError('شماره یکی از پیوست‌ها نامعتبر است.', 400);
      if (size < 0 || size > MAX_FILE_SIZE) throw new StoreError('حجم هر پیوست باید حداکثر ۲٫۵ مگابایت باشد.', 400);
      totalBytes += size;
      return {
        index,
        name: String(file.name || 'attachment').slice(0, 240),
        type: String(file.type || 'application/octet-stream').slice(0, 120),
        size
      };
    });
    if (totalBytes > MAX_TOTAL_FILE_SIZE) throw new StoreError('حجم کل پیوست‌ها نباید از ۱۲٫۵ مگابایت بیشتر باشد.', 400);

    const letter = {
      id,
      sender: String(input.sender || 'ناشناس').slice(0, 80),
      subject: String(input.subject || 'بدون عنوان').slice(0, 120),
      message: message.slice(0, 50000),
      createdAt: input.createdAt && !Number.isNaN(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : new Date().toISOString(),
      attachments: normalizedAttachments
    };

    await modifyLetters((letters) => {
      if (letters.some((item) => item.id === letter.id)) throw new StoreError('این پیام قبلاً ثبت شده است.', 409);
      letters.push(letter);
      return letters;
    }, `Add student voice message ${letter.id}`);

    return sendJson(res, 201, { ok: true, id: letter.id });
  } catch (error) {
    return errorResponse(res, error);
  }
};
