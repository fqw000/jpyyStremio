/**
 * 0996zp.com 接口签名与域名探测
 *
 * @fileoverview
 *   1. 纯 JS 实现 MD5 / SHA1 / UTF-8 编码
 *   2. 复现站点签名算法并请求接口
 *   3. 输出本次请求的 t / sign 与域名列表
 *
 * @algorithm
 *   sign = SHA1( MD5( g + "&key=" + signKey + "&t=" + t ) )
 *   其中 g 为参数串：
 *     GET  → Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&")
 *     POST → JSON.stringify(params)
 *     空   → ""
 *
 * @headers
 *   sign, t, deviceId, client-type, Authorization
 *
 * @requires Node.js >= 18 (内置 fetch)
 *
 * @usage
 *   node <filename>.js
 *
 * @notes
 *   - t 与 sign 必须配对，header 里的 t 要与签名用的 t 相同
 *   - 返回 403 "cc policy" 属 WAF 拦截，与签名无关
 *   - 如需在 Node 中稳定请求，需处理 Cookie / TLS 指纹
 */

// ==========================================
// 1. UTF-8 编码
// ==========================================
function utf8Encode(str) {
    str = str.replace(/\r\n/g, "\n");
    let out = "";
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c < 128) {
            out += String.fromCharCode(c);
        } else if (c < 2048) {
            out += String.fromCharCode((c >> 6) | 192, (c & 63) | 128);
        } else {
            out += String.fromCharCode((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
        }
    }
    return out;
}

// ==========================================
// 2. MD5
// ==========================================
function md5(str) {
    const rot = (v, s) => (v << s) | (v >>> (32 - s));
    const add = (x, y) => {
        const x8 = x & 0x80000000, y8 = y & 0x80000000;
        const x4 = x & 0x40000000, y4 = y & 0x40000000;
        let r = (x & 0x3fffffff) + (y & 0x3fffffff);
        if (x4 & y4) return r ^ 0x80000000 ^ x8 ^ y8;
        if (x4 | y4) return (r & 0x40000000) ? (r ^ 0xc0000000 ^ x8 ^ y8) : (r ^ 0x40000000 ^ x8 ^ y8);
        return r ^ x8 ^ y8;
    };
    const F = (x, y, z) => (x & y) | (~x & z);
    const G = (x, y, z) => (x & z) | (y & ~z);
    const H = (x, y, z) => x ^ y ^ z;
    const I = (x, y, z) => y ^ (x | ~z);
    const FF = (a, b, c, d, x, s, ac) => add(rot(add(add(add(F(b, c, d), x), ac), a), s), b);
    const GG = (a, b, c, d, x, s, ac) => add(rot(add(add(add(G(b, c, d), x), ac), a), s), b);
    const HH = (a, b, c, d, x, s, ac) => add(rot(add(add(add(H(b, c, d), x), ac), a), s), b);
    const II = (a, b, c, d, x, s, ac) => add(rot(add(add(add(I(b, c, d), x), ac), a), s), b);

    function toWords(s) {
        const len = s.length;
        const n = (((len + 8) - ((len + 8) % 64)) / 64 + 1) * 16;
        const arr = new Array(n - 1);
        let bc = 0;
        while (bc < len) {
            const wc = (bc - (bc % 4)) / 4;
            const bp = (bc % 4) * 8;
            arr[wc] = arr[wc] | (s.charCodeAt(bc) << bp);
            bc++;
        }
        const wc = (bc - (bc % 4)) / 4;
        const bp = (bc % 4) * 8;
        arr[wc] = arr[wc] | (0x80 << bp);
        arr[n - 2] = len << 3;
        arr[n - 1] = len >>> 29;
        return arr;
    }
    const toHex = (v) => {
        let out = "";
        for (let i = 0; i <= 3; i++) {
            const b = (v >>> (i * 8)) & 255;
            out += ("0" + b.toString(16)).slice(-2);
        }
        return out;
    };

    str = utf8Encode(str);
    const x = toWords(str);

    const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
    const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
    const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
    const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

    let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;

    for (let k = 0; k < x.length; k += 16) {
        const AA = a, BB = b, CC = c, DD = d;

        a = FF(a, b, c, d, x[k + 0], S11, 0xd76aa478);
        d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
        c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
        b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
        a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
        d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
        c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
        b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
        a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
        d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
        c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
        b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
        a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
        d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
        c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e);
        b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);

        a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
        d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
        c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
        b = GG(b, c, d, a, x[k + 0], S24, 0xe9b6c7aa);
        a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
        d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
        c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
        b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
        a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
        d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
        c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
        b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
        a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
        d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
        c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
        b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);

        a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
        d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
        c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
        b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
        a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
        d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
        c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
        b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
        a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
        d = HH(d, a, b, c, x[k + 0], S32, 0xeaa127fa);
        c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
        b = HH(b, c, d, a, x[k + 6], S34, 0x4881d05);
        a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
        d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
        c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
        b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);

        a = II(a, b, c, d, x[k + 0], S41, 0xf4292244);
        d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
        c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
        b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
        a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
        d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
        c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
        b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
        a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
        d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
        c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
        b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
        a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
        d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
        c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
        b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);

        a = add(a, AA);
        b = add(b, BB);
        c = add(c, CC);
        d = add(d, DD);
    }
    return (toHex(a) + toHex(b) + toHex(c) + toHex(d)).toLowerCase();
}

// ==========================================
// 3. SHA1
// ==========================================
function sha1(msg) {
    const rot = (n, s) => (n << s) | (n >>> (32 - s));
    const toHex = (v) => {
        let s = "";
        for (let i = 7; i >= 0; i--) s += ((v >>> (i * 4)) & 0xf).toString(16);
        return s;
    };

    msg = utf8Encode(msg);
    const len = msg.length;
    const words = [];
    for (let i = 0; i < len - 3; i += 4) {
        words.push((msg.charCodeAt(i) << 24) | (msg.charCodeAt(i + 1) << 16) | (msg.charCodeAt(i + 2) << 8) | msg.charCodeAt(i + 3));
    }

    let tail;
    switch (len % 4) {
        case 0: tail = 0x080000000; break;
        case 1: tail = (msg.charCodeAt(len - 1) << 24) | 0x0800000; break;
        case 2: tail = (msg.charCodeAt(len - 2) << 24) | (msg.charCodeAt(len - 1) << 16) | 0x08000; break;
        case 3: tail = (msg.charCodeAt(len - 3) << 24) | (msg.charCodeAt(len - 2) << 16) | (msg.charCodeAt(len - 1) << 8) | 0x80; break;
    }
    words.push(tail);
    while (words.length % 16 !== 14) words.push(0);
    words.push(len >>> 29);
    words.push((len << 3) & 0x0ffffffff);

    let H0 = 0x67452301, H1 = 0xefcdab89, H2 = 0x98badcfe, H3 = 0x10325476, H4 = 0xc3d2e1f0;

    for (let bs = 0; bs < words.length; bs += 16) {
        const W = new Array(80);
        for (let i = 0; i < 16; i++) W[i] = words[bs + i];
        for (let i = 16; i <= 79; i++) W[i] = rot(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);

        let A = H0, B = H1, C = H2, D = H3, E = H4;
        let temp;
        for (let i = 0; i <= 19; i++) {
            temp = (rot(A, 5) + ((B & C) | (~B & D)) + E + W[i] + 0x5a827999) & 0x0ffffffff;
            E = D; D = C; C = rot(B, 30); B = A; A = temp;
        }
        for (let i = 20; i <= 39; i++) {
            temp = (rot(A, 5) + (B ^ C ^ D) + E + W[i] + 0x6ed9eba1) & 0x0ffffffff;
            E = D; D = C; C = rot(B, 30); B = A; A = temp;
        }
        for (let i = 40; i <= 59; i++) {
            temp = (rot(A, 5) + ((B & C) | (B & D) | (C & D)) + E + W[i] + 0x8f1bbcdc) & 0x0ffffffff;
            E = D; D = C; C = rot(B, 30); B = A; A = temp;
        }
        for (let i = 60; i <= 79; i++) {
            temp = (rot(A, 5) + (B ^ C ^ D) + E + W[i] + 0xca62c1d6) & 0x0ffffffff;
            E = D; D = C; C = rot(B, 30); B = A; A = temp;
        }

        H0 = (H0 + A) & 0x0ffffffff;
        H1 = (H1 + B) & 0x0ffffffff;
        H2 = (H2 + C) & 0x0ffffffff;
        H3 = (H3 + D) & 0x0ffffffff;
        H4 = (H4 + E) & 0x0ffffffff;
    }

    return (toHex(H0) + toHex(H1) + toHex(H2) + toHex(H3) + toHex(H4)).toLowerCase();
}

// ==========================================
// 4. 签名生成
// ==========================================
const SIGN_KEY = "cb808529bae6b6be45ecfab29a4889bc";
const DEVICE_ID = "39cb57bc-f77b-42c8-84e8-25fe857385d1";
const TOKEN = "";
const BASE_URL = "https://jpyy.com";

/**
 * 生成签名
 * @param {Object} opts
 * @param {string} opts.method - HTTP 方法，默认 GET
 * @param {Object} opts.params - 请求参数
 * @param {number} opts.t - 时间戳（毫秒）
 * @param {string} [opts.signKey] - 签名密钥，默认用 SIGN_KEY
 * @returns {string} sign
 */
function genSign({ method = "GET", params = {}, t, signKey = SIGN_KEY }) {
    let g = "";
    if (method.toUpperCase() === "GET") {
        const keys = Object.keys(params).sort();
        g = keys.length ? keys.map(k => `${k}=${params[k]}`).join("&") : "";
    } else {
        g = Object.keys(params).length ? JSON.stringify(params) : "";
    }
    const h = g ? `${g}&key=${signKey}&t=${t}` : `key=${signKey}&t=${t}`;
    return sha1(md5(h));
}

/**
 * 发请求
 * @param {string} path - 接口路径
 * @param {Object} params - 查询参数
 * @returns {Promise<{status:number, contentType:string, text:string}>}
 */
async function request(path, params = {}) {
    const t = Date.now();
    const sign = genSign({ method: "GET", params, t });

    const qs = Object.keys(params)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join("&");
    const url = `${BASE_URL}${path}${qs ? "?" + qs : ""}`;

    const res = await fetch(url, {
        method: "GET",
        headers: {
            Accept: "application/json, text/plain, */*",
            Authorization: TOKEN,
            sign,
            t: String(t),
            deviceId: DEVICE_ID,
            "client-type": "1",
            "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
        },
    });

    const text = await res.text();
    return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        text,
        t,
        sign,
    };
}

// ==========================================
// 5. 主流程
// ==========================================
async function main() {
    const result = await request("/api/mw-movie/anonymous/website/get/domain", { websiteSeoId: 86 });

    if (result.status !== 200) {
        throw new Error(` ❌ HTTP ${result.status}: ${result.text.slice(0, 200)}`);
    }

    let json;
    try {
        json = JSON.parse(result.text);
    } catch (e) {
        throw new Error(` ❌ 响应不是 JSON: ${result.text.slice(0, 200)}`);
    }

    if (json.code !== 200) {
        throw new Error(` ❌ 业务错误 code=${json.code}: ${json.msg}`);
    }

    return {
        domains: json.data,
        t: result.t,
        sign: result.sign,
    };
}
    
main()
    .then(({ domains, t, sign }) => {
        console.log("[ ⛳︎ 请求URL ]", `${BASE_URL}/api/mw-movie/anonymous/website/get/domain?websiteSeoId=86`);
        console.log("========== 加密数据 ==========");
        console.log("[ ⏱️ timestamp ] ", t);
        console.log("[ 🔑 sign ] ", sign);
        console.log("========== 域名列表 ==========");
        console.log("[ 🖨️ 域名列表 ]:", domains);
    })
    .catch(err => {
        console.error(" ❌ 失败:", err.message);
    });