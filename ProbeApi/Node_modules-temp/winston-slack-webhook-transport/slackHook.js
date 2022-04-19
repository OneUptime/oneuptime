'use strict';

const Transport = require('winston-transport');
const axios = require('axios').default;

module.exports = class SlackHook extends Transport {
  constructor (opts) {
    super(opts);

    opts = opts || {};

    this.name = opts.name || 'slackWebhook';
		this.level = opts.level || undefined;
    this.webhookUrl = opts.webhookUrl;
    this.formatter = opts.formatter || undefined;
    this.unfurlLinks = opts.unfurlLinks || false;
    this.unfurlMedia = opts.unfurlMedia || false;
    this.mrkdwn = opts.mrkdwn || false;

    this.axiosInstance = axios.create({
      proxy: opts.proxy || undefined
    });
  }

  log (info, callback) {
		let payload = {
      unfurl_links: this.unfurlLinks,
      unfurl_media: this.unfurlMedia,
      mrkdwn: this.mrkdwn
    }

    if (this.formatter && typeof this.formatter === 'function') {
      let layout = this.formatter(info);

      if (!layout) return;

      // Note: Supplying `text` when `blocks` is also supplied will cause `text` 
      // to be used as a fallback for clients/surfaces that don't suopport blocks
      payload.text = layout.text || undefined;
      payload.attachments = layout.attachments || undefined;
      payload.blocks = layout.blocks || undefined;
    } else {
      payload.text = `${info.level}: ${info.message}`
    }

    this.axiosInstance.post(this.webhookUrl, payload)
    .then(response => {
      this.emit('logged', info);
      callback();
    })
    .catch(err => {
      this.emit('error', err);
      callback();
    });
  }
}
