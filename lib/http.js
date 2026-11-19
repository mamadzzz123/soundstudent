'use strict';

const { StoreError } = require('./github-store');

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  if (typeof req.body === 'string' && req.body.length) return JSON.parse(req.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) {
      throw new StoreError('حجم درخواست بیشتر از حد مجاز Vercel است؛ حجم هر فایل را کمتر کن.', 413);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function errorResponse(res, error) {
  console.error('[student-voice-api]', error && error.message ? error.message : error);
  const status = Number(error && error.statusCode) || 500;
  sendJson(res, status, {
    error: error && error.message ? error.message : 'خطای غیرمنتظره در سرور رخ داد.'
  });
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, { error: `متد مجاز: ${allowed.join(', ')}` });
}

module.exports = { sendJson, readBody, errorResponse, methodNotAllowed };
