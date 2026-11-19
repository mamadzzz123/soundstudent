'use strict';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'GET only' }));
  }
  const configured = Boolean(
    process.env.GITHUB_TOKEN &&
    process.env.GITHUB_OWNER &&
    process.env.GITHUB_REPO
  );
  res.statusCode = configured ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: configured,
    storage: 'github-contents-api',
    configured,
    message: configured ? 'API route is deployed and environment variables are present.' : 'GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO must be set in Vercel.'
  }));
};
