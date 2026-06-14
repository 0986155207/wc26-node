/************************************************************************
 *  Web Push — đăng ký / hủy / lấy khóa công khai
 *    GET  /api/push?action=key            → { publicKey }
 *    POST /api/push  { action:'subscribe', subscription, prefs }
 *    POST /api/push  { action:'unsubscribe', endpoint }
 ************************************************************************/

import { publicKey, saveSubscription, removeSubscription } from '../lib/push.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Trả khóa công khai VAPID để trình duyệt đăng ký
      res.status(200).json({ publicKey: publicKey() });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.action === 'subscribe') {
        await saveSubscription(body.subscription, body.prefs);
        res.status(200).json({ ok: true });
        return;
      }
      if (body.action === 'unsubscribe') {
        await removeSubscription(body.endpoint);
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: 'action không hợp lệ.' });
      return;
    }

    res.status(405).json({ error: 'Phương thức không hỗ trợ.' });
  } catch (err) {
    console.error('[api/push]', err);
    res.status(500).json({ error: err.message });
  }
}