'use strict';

const LETTERS_PATH = 'data/letters.json';
const MAX_RETRIES = 4;

class StoreError extends Error {
  constructor(message, statusCode = 500, githubStatus = null) {
    super(message);
    this.name = 'StoreError';
    this.statusCode = statusCode;
    this.githubStatus = githubStatus;
  }
}

function getConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    throw new StoreError(
      'ذخیره‌سازی هنوز تنظیم نشده است. در Vercel متغیرهای GITHUB_TOKEN، GITHUB_OWNER و GITHUB_REPO را اضافه کن و سپس دوباره Deploy بگیر.',
      503
    );
  }

  return { token, owner, repo, branch };
}

function contentsUrl(filePath) {
  const { owner, repo } = getConfig();
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
}

function githubHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'student-voice-vercel-app'
  };
}

async function readError(response) {
  let detail = '';
  try {
    const payload = await response.json();
    detail = payload && payload.message ? `: ${payload.message}` : '';
  } catch (_) {
    try { detail = `: ${(await response.text()).slice(0, 200)}`; } catch (_) { /* ignore */ }
  }
  const status = response.status;
  if (status === 401 || status === 403) {
    return new StoreError(`GitHub اجازهٔ دسترسی نداد (${status}). توکن و مجوز Contents را بررسی کن.`, 502, status);
  }
  if (status === 404) {
    return new StoreError(`مخزن یا مسیر ذخیره‌سازی در GitHub پیدا نشد (${status}). نام مالک، مخزن و شاخه را بررسی کن.${detail}`, 502, status);
  }
  return new StoreError(`خطای GitHub (${status})${detail}`, 502, status);
}

async function getRepoFile(filePath, { includeContent = false } = {}) {
  const { token } = getConfig();
  const response = await fetch(contentsUrl(filePath), {
    method: 'GET',
    headers: githubHeaders(token)
  });

  if (response.status === 404) return null;
  if (!response.ok) throw await readError(response);

  const payload = await response.json();
  let content = null;

  if (includeContent) {
    if (typeof payload.content === 'string' && payload.content.trim()) {
      content = Buffer.from(payload.content.replace(/\n/g, ''), 'base64');
    } else {
      // GitHub's JSON representation omits content for some larger files.
      const rawResponse = await fetch(contentsUrl(filePath), {
        method: 'GET',
        headers: githubHeaders(token, 'application/vnd.github.raw+json')
      });
      if (!rawResponse.ok) throw await readError(rawResponse);
      content = Buffer.from(await rawResponse.arrayBuffer());
    }
  }

  return { sha: payload.sha, size: payload.size || 0, content };
}

async function putRepoFile(filePath, content, message, sha = undefined) {
  const { token, branch } = getConfig();
  const body = {
    message,
    content: Buffer.isBuffer(content) ? content.toString('base64') : Buffer.from(String(content), 'utf8').toString('base64'),
    branch
  };
  if (sha) body.sha = sha;

  const response = await fetch(contentsUrl(filePath), {
    method: 'PUT',
    headers: {
      ...githubHeaders(token),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw await readError(response);
  return response.json();
}

async function deleteRepoFile(filePath, message) {
  const current = await getRepoFile(filePath);
  if (!current) return;

  const { token, branch } = getConfig();
  const response = await fetch(contentsUrl(filePath), {
    method: 'DELETE',
    headers: {
      ...githubHeaders(token),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, sha: current.sha, branch })
  });

  if (!response.ok && response.status !== 404) throw await readError(response);
}

function parseLettersBuffer(content) {
  try {
    const value = JSON.parse(content.toString('utf8'));
    if (!Array.isArray(value)) throw new Error('not an array');
    return value;
  } catch (_) {
    throw new StoreError('محتوای data/letters.json در مخزن GitHub معتبر نیست.', 500);
  }
}

async function readLettersWithSha() {
  const file = await getRepoFile(LETTERS_PATH, { includeContent: true });
  if (!file) return { letters: [], sha: null };
  return { letters: parseLettersBuffer(file.content), sha: file.sha };
}

async function readLetters() {
  const { letters } = await readLettersWithSha();
  return letters;
}

async function modifyLetters(mutator, commitMessage) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = await readLettersWithSha();
    const nextLetters = mutator(current.letters.slice());
    try {
      await putRepoFile(LETTERS_PATH, JSON.stringify(nextLetters, null, 2) + '\n', commitMessage, current.sha);
      return nextLetters;
    } catch (error) {
      const isCommitConflict = error && (error.githubStatus === 409 || error.githubStatus === 422);
      if (!isCommitConflict || attempt === MAX_RETRIES - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  throw new StoreError('ذخیره پیام پس از چند تلاش انجام نشد. دوباره تلاش کن.', 503);
}

function attachmentPath(letterId, index) {
  return `data/attachments/${letterId}/${index}.bin`;
}

async function writeAttachment(letterId, index, bytes) {
  const filePath = attachmentPath(letterId, index);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = await getRepoFile(filePath);
    try {
      await putRepoFile(filePath, bytes, `Store student voice attachment ${letterId}/${index}`, current ? current.sha : undefined);
      return;
    } catch (error) {
      const isCommitConflict = error && (error.githubStatus === 409 || error.githubStatus === 422);
      if (!isCommitConflict || attempt === MAX_RETRIES - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
}

async function readAttachment(letterId, index) {
  const filePath = attachmentPath(letterId, index);
  const file = await getRepoFile(filePath, { includeContent: true });
  if (!file) return null;
  return file.content;
}

async function removeAttachments(letter) {
  const attachments = Array.isArray(letter && letter.attachments) ? letter.attachments : [];
  for (const attachment of attachments) {
    const index = Number(attachment.index);
    if (!Number.isInteger(index) || index < 0 || index > 4) continue;
    await deleteRepoFile(attachmentPath(letter.id, index), `Delete student voice attachment ${letter.id}/${index}`);
  }
}

module.exports = {
  StoreError,
  getConfig,
  readLetters,
  modifyLetters,
  attachmentPath,
  writeAttachment,
  readAttachment,
  removeAttachments
};
