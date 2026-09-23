/**
 * JPYY · 配置页面交互逻辑
 * 
 * 功能：
 * - 收集用户配置
 * - 编码为 base64url
 * - 生成安装 URL
 * - 展示二维码
 * 
 * @module public/configure
 */

(function () {
    'use strict';

    // ==========================================
    // 常量
    // ==========================================

    const DEFAULTS = {
        baseDomain: '0996zp.com',
        enableImdb: true,
    };

    const STREMIO_PROTOCOL = 'stremio://';

    // ==========================================
    // DOM 缓存
    // ==========================================

    const $ = (id) => document.getElementById(id);

    const el = {
        baseDomain: $('baseDomain'),
        tmdbApiKey: $('tmdbApiKey'),
        enableImdb: $('enableImdb'),
        toggleTmdbKey: $('toggleTmdbKey'),

        generateBtn: $('generateBtn'),
        resetBtn: $('resetBtn'),

        resultCard: $('resultCard'),
        manifestUrl: $('manifestUrl'),
        copyBtn: $('copyBtn'),
        installBtn: $('installBtn'),
        webInstallBtn: $('webInstallBtn'),
        configPreview: $('configPreview'),
        qrcode: $('qrcode'),
    };

    // ==========================================
    // 工具函数
    // ==========================================

    /**
     * 获取站点基础 URL
     */
    function getBaseUrl() {
        return window.location.origin;
    }

    /**
     * 将配置对象编码为 base64url
     * 
     * @param {Object} config
     * @returns {string}
     */
    function encodeConfig(config) {
        try {
            const json = JSON.stringify(config);
            // 转义 Unicode
            const escaped = unescape(encodeURIComponent(json));
            const base64 = btoa(escaped);
            // base64 → base64url
            return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        } catch (err) {
            console.error('配置编码失败:', err);
            return '';
        }
    }

    /**
     * 从表单收集配置
     * 
     * @returns {Object}
     */
    /**
    * 从表单收集配置
    * 
    * @returns {Object}
    */
    function collectConfig() {
        const config = {};

        // 资源站域名
        const bd = el.baseDomain.value.trim();
        if (bd && bd !== DEFAULTS.baseDomain) {
            config.bd = bd;
        }

        // TMDB API Key
        const tk = el.tmdbApiKey.value.trim();
        if (tk) {
            config.tk = tk;
        }

        // ===== 支持类型（新增）=====
        const ALL_CATEGORIES = ['movie', 'series', 'variety', 'anime', 'short'];
        const checkedCategories = Array.from(
            document.querySelectorAll('.category-cb:checked')
        ).map(cb => cb.value);

        // 只有当类型不是"全部"时才写入配置
        if (checkedCategories.length > 0 && checkedCategories.length < ALL_CATEGORIES.length) {
            config.cats = checkedCategories;
        }

        // 用户一个都不选：用空数组表示
        if (checkedCategories.length === 0) {
            config.cats = [];
        }

        // IMDb 解析（默认 true，关闭时才写入）
        if (!el.enableImdb.checked) {
            config.imdb = false;
        }

        return config;
    }


    /**
     * 构建安装 URL
     * 
     * @param {Object} config
     * @returns {{manifestUrl: string, stremioUrl: string, hasConfig: boolean}}
     */
    function buildUrls(config) {
        const base = getBaseUrl();
        const hasConfig = Object.keys(config).length > 0;

        let manifestUrl = `${base}/manifest.json`;
        if (hasConfig) {
            const encoded = encodeConfig(config);
            manifestUrl += `?cfg=${encoded}`;
        }

        // Stremio 协议链接
        const hostAndPath = manifestUrl.replace(/^https?:\/\//, '');
        const stremioUrl = `${STREMIO_PROTOCOL}${hostAndPath}`;

        return { manifestUrl, stremioUrl, hasConfig };
    }

    // ==========================================
    // Toast 提示
    // ==========================================

    let toastTimer = null;

    function showToast(message, type = 'info') {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.className = `toast ${type}`;

        // 触发重排以重启动画
        void toast.offsetWidth;
        toast.classList.add('show');

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    }

    // ==========================================
    // 二维码
    // ==========================================

    let qrcodeInstance = null;

    function updateQRCode(url) {
        el.qrcode.innerHTML = '';

        if (typeof QRCode === 'undefined') {
            el.qrcode.textContent = '二维码库加载失败';
            return;
        }

        try {
            qrcodeInstance = new QRCode(el.qrcode, {
                text: url,
                width: 180,
                height: 180,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M,
            });
        } catch (err) {
            console.error('二维码生成失败:', err);
            el.qrcode.textContent = '二维码生成失败';
        }
    }

    // ==========================================
    // 核心逻辑
    // ==========================================

    function generate() {
        const config = collectConfig();
        const urls = buildUrls(config);

        // 更新 URL
        el.manifestUrl.value = urls.manifestUrl;

        // 更新安装按钮
        el.installBtn.href = urls.stremioUrl;

        // 更新配置预览
        el.configPreview.textContent = JSON.stringify(
            {
                config: Object.keys(config).length === 0 ? '(默认配置)' : config,
                manifest: urls.manifestUrl,
                stremio: urls.stremioUrl,
            },
            null,
            2
        );

        // 更新二维码
        updateQRCode(urls.manifestUrl);

        // 显示结果卡片
        el.resultCard.classList.add('show');

        // 滚动到结果
        setTimeout(() => {
            el.resultCard.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
        }, 100);
    }

    function reset() {
        el.baseDomain.value = '';
        el.tmdbApiKey.value = '';
        el.tmdbApiKey.type = 'password';
        el.enableImdb.checked = DEFAULTS.enableImdb;

        // ===== 重置类型为全选 =====
        document.querySelectorAll('.category-cb').forEach(cb => {
            cb.checked = true;
        });

        el.resultCard.classList.remove('show');

        showToast('已重置为默认配置');
    }

    function copyUrl() {
        const url = el.manifestUrl.value;
        if (!url) return;

        const doCopy = () => {
            if (navigator.clipboard && window.isSecureContext) {
                return navigator.clipboard.writeText(url);
            }
            // 降级方案
            el.manifestUrl.select();
            el.manifestUrl.setSelectionRange(0, 99999);
            document.execCommand('copy');
            return Promise.resolve();
        };

        doCopy()
            .then(() => {
                showToast('✅ 已复制到剪贴板', 'success');
            })
            .catch((err) => {
                console.error('复制失败:', err);
                showToast('复制失败，请手动选择', 'error');
            });
    }

    function webInstall() {
        const url = el.manifestUrl.value;
        if (!url) return;

        const encoded = encodeURIComponent(url);
        window.open(
            `https://web.stremio.com/#/addons?addon=${encoded}`,
            '_blank'
        );
    }

    function toggleTmdbKey() {
        el.tmdbApiKey.type = el.tmdbApiKey.type === 'password' ? 'text' : 'password';
    }

    // ==========================================
    // 事件绑定
    // ==========================================

    el.generateBtn.addEventListener('click', generate);
    el.resetBtn.addEventListener('click', reset);
    el.copyBtn.addEventListener('click', copyUrl);
    el.webInstallBtn.addEventListener('click', webInstall);
    el.toggleTmdbKey.addEventListener('click', toggleTmdbKey);

    // 输入变化时自动更新（如果结果卡片已显示）
    [el.baseDomain, el.tmdbApiKey, el.enableImdb].forEach((input) => {
        input.addEventListener('change', () => {
            if (el.resultCard.classList.contains('show')) {
                generate();
            }
        });
    });

    // ===== 类型 checkbox 变化时也更新 =====
    document.querySelectorAll('.category-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            if (el.resultCard.classList.contains('show')) {
                generate();
            }
        });
    });

    // 回车键快捷生成
    [el.baseDomain, el.tmdbApiKey].forEach((input) => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                generate();
            }
        });
    });

    // ==========================================
    // 初始化
    // ==========================================

    window.addEventListener('DOMContentLoaded', () => {
        // 从 URL 预填配置（如果带 ?prefill=xxx）
        const params = new URLSearchParams(location.search);
        const prefill = params.get('prefill');
        if (prefill) {
            try {
                const json = decodeURIComponent(escape(atob(
                    prefill.replace(/-/g, '+').replace(/_/g, '/')
                )));
                const config = JSON.parse(json);
                if (config.bd) el.baseDomain.value = config.bd;
                if (config.tk) el.tmdbApiKey.value = config.tk;
                if (config.imdb === false) el.enableImdb.checked = false;
            } catch (err) {
                console.warn('预填配置解析失败:', err);
            }
        }

        // 如果 URL 带 ?autogen=1，自动生成
        if (params.has('autogen')) {
            generate();
        }
    });
})();