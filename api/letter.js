'use strict';

const { readLetters, modifyLetters, removeAttachments, StoreError } = require('../lib/github-store');
const { sendJson, errorResponse, methodNotAllowed } = require('../lib/http');

module.exports = async function handler(req, res) {
  try {
    const id = String((req.query && req.query.id) || '').trim();
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new StoreError('شناسه پیام معتبر نیست.', 400);

    if (req.method === 'GET') {
      const letters = await readLetters();
      const letter = letters.find((item) => item.id === id);
      if (!letter) throw new StoreError('این پیام پیدا نشد.', 404);
      return sendJson(res, 200, letter);
    }

    if (req.method !== 'DELETE') return methodNotAllowed(res, ['GET', 'DELETE']);

    let deletedLetter = null;
    await modifyLetters((letters) => {
      const index = letters.findIndex((item) => item.id === id);
      if (index === -1) throw new StoreError('این پیام پیدا نشد.', 404);
      deletedLetter = letters[index];
      letters.splice(index, 1);
      return letters;
    }, `Delete student voice message ${id}`);

    if (deletedLetter) {
      try {
        await removeAttachments(deletedLetter);
      } catch (cleanupError) {
        console.error('[student-voice-api] پیوست‌های حذف‌شده پاک‌سازی نشدند:', cleanupError.message);
      }
    }
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return errorResponse(res, error);
  }
};
