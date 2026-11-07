// Exact post time from an X (Twitter) or TikTok post URL or ID: node postdate.mjs <url or id>
const input = process.argv[2] ?? ''
const ids = input.match(/\d{15,20}/g)
if (!ids) {
  console.error('usage: node postdate.mjs <x.com or tiktok.com post URL, or a post ID>')
  process.exit(1)
}
const id = BigInt(ids.at(-1))
const x = new Date(Number((id >> 22n) + 1288834974657n)).toISOString()
const tiktok = new Date(Number(id >> 32n) * 1000).toISOString()
if (/tiktok/i.test(input)) console.log(`TikTok post time: ${tiktok}`)
else if (/x\.com|twitter\.com/i.test(input)) console.log(`X post time: ${x}`)
else console.log(`If this is an X post: ${x}\nIf this is a TikTok post: ${tiktok}`)
