/**
 * JPYY · 配置页面交互逻辑
 *
 * 功能：
 * - 收集用户配置（源开关、jpyy、555）
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
        domain555: 'www.555zxdy.cc',
        enableImdb: true,
        enableStream: true,
        enableJpyy: true,
        enable555: true,
    };

    const ALL_JPYY_CATEGORIES = ['movie', 'series', 'variety', 'anime', 'short'];
    const ALL_555_CATEGORIES = ['movie', 'series', 'anime', 'variety', 'short', 'sports', 'new'];
    const ALL_SOURCES = ['jpyy', '555'];

    const STREMIO_PROTOCOL = 'stremio://';

    // ==========================================
    // DOM 缓存
    // ==========================================

    const $ = (id) => document.getElementById(id);

    const el = {
        baseDomain: $('baseDomain'),
        tmdbApiKey: $('tmdbApiKey'),
        domain555: $('domain555'),
        enableImdb: $('enableImdb'),
        enableStream: $('enableStream'),
        toggleTmdbKey: $('toggleTmdbKey'),

        jpyySection: $('jpyySection'),
        section555: $('section555'),

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

    function getBaseUrl() {
        return window.location.origin;
    }

    /**
     * 将配置对象编码为 base64url
     */
    function encodeConfig(config) {
        try {
            const json = JSON.stringify(config);
            const escaped = unescape(encodeURIComponent(json));
            const base64 = btoa(escaped);
            return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        } catch (err) {
            console.error('配置编码失败:', err);
            return '';
        }
    }

    /**
     * 读取源开关
     */
    function getCheckedSources() {
        return Array.from(document.querySelectorAll('.source-cb:checked'))
            .map(cb => cb.value);
    }

    /**
     * 从表单收集配置
     */
    function collectConfig() {
        const config = {};

        // ===== 影视源 =====
        const checkedSources = getCheckedSources();

        // 全选时默认（不写入）；只选一个或空时写入
        if (checkedSources.length === 0) {
            // 异常：一个都没选 → 强制 jpyy，避免 addon 完全不可用
            config.srcs = ['jpyy'];
        } else if (checkedSources.length < ALL_SOURCES.length) {
            config.srcs = checkedSources;
        }

        const jpyyEnabled = checkedSources.includes('jpyy');
        const movie555Enabled = checkedSources.includes('555');

        // ===== jpyy 配置 =====
        if (jpyyEnabled) {
            const bd = el.baseDomain.value.trim();
            if (bd && bd !== DEFAULTS.baseDomain) {
                config.bd = bd;
            }

            const tk = el.tmdbApiKey.value.trim();
            if (tk) {
                config.tk = tk;
            }

            const checkedJpyyCats = Array.from(
                document.querySelectorAll('.category-cb:checked')
            ).map(cb => cb.value);

            if (checkedJpyyCats.length > 0 && checkedJpyyCats.length < ALL_JPYY_CATEGORIES.length) {
                config.cats = checkedJpyyCats;
            }
            if (checkedJpyyCats.length === 0) {
                config.cats = [];
            }

            if (!el.enableImdb.checked) {
                config.imdb = false;
            }
            if (!el.enableStream.checked) {
                config.stream = false;
            }
        }

        // ===== 555 配置 =====
        if (movie555Enabled) {
            const d555 = el.domain555.value.trim();
            if (d555 && d555 !== DEFAULTS.domain555) {
                config.d555 = d555;
            }

            const checked555Cats = Array.from(
                document.querySelectorAll('.cat555-cb:checked')
            ).map(cb => cb.value);

            if (checked555Cats.length > 0 && checked555Cats.length < ALL_555_CATEGORIES.length) {
                config.c555 = checked555Cats;
            }
            if (checked555Cats.length === 0) {
                config.c555 = [];
            }
        }

        return config;
    }

    /**
     * 构建安装 URL
     */
    function buildUrls(config) {
        const base = getBaseUrl();
        const hasConfig = Object.keys(config).length > 0;

        let manifestUrl = `${base}/manifest.json`;
        if (hasConfig) {
            const encoded = encodeConfig(config);
            manifestUrl += `?cfg=${encoded}`;
        }

        const hostAndPath = manifestUrl.replace(/^https?:\/\//, '');
        const stremioUrl = `${STREMIO_PROTOCOL}${hostAndPath}`;

        return { manifestUrl, stremioUrl, hasConfig };
    }

    // ==========================================
    // 源开关联动
    // ==========================================

    /**
     * 根据勾选的源，显示/隐藏对应配置区
     */
    function updateSourceSections() {
        const sources = getCheckedSources();
        const jpyyOn = sources.includes('jpyy');
        const movie555On = sources.includes('555');

        el.jpyySection.classList.toggle('disabled', !jpyyOn);
        el.section555.classList.toggle('disabled', !movie555On);
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

        el.manifestUrl.value = urls.manifestUrl;
        el.installBtn.href = urls.stremioUrl;

        el.configPreview.textContent = JSON.stringify(
            {
                config: Object.keys(config).length === 0 ? '(默认配置)' : config,
                manifest: urls.manifestUrl,
                stremio: urls.stremioUrl,
            },
            null,
            2
        );

        updateQRCode(urls.manifestUrl);
        el.resultCard.classList.add('show');

        setTimeout(() => {
            el.resultCard.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
        }, 100);
    }

    function reset() {
        // 源开关：默认全开
        document.querySelectorAll('.source-cb').forEach(cb => {
            cb.checked = true;
        });

        // jpyy 配置
        el.baseDomain.value = '';
        el.tmdbApiKey.value = '';
        el.tmdbApiKey.type = 'password';
        el.enableImdb.checked = DEFAULTS.enableImdb;
        el.enableStream.checked = DEFAULTS.enableStream;

        document.querySelectorAll('.category-cb').forEach(cb => {
            cb.checked = true;
        });

        // 555 配置
        el.domain555.value = '';
        document.querySelectorAll('.cat555-cb').forEach(cb => {
            cb.checked = true;
        });

        // 联动状态刷新
        updateSourceSections();

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
            el.manifestUrl.select();
            el.manifestUrl.setSelectionRange(0, 99999);
            document.execCommand('copy');
            return Promise.resolve();
        };

        doCopy()
            .then(() => showToast('✅ 已复制到剪贴板', 'success'))
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

    // ===== 源开关变化：联动 + 更新结果 =====
    document.querySelectorAll('.source-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            updateSourceSections();
            if (el.resultCard.classList.contains('show')) {
                generate();
            }
        });
    });

    // ===== 输入变化时自动更新（如果结果卡片已显示）=====
    [el.baseDomain, el.tmdbApiKey, el.domain555, el.enableImdb, el.enableStream]
        .filter(Boolean)
        .forEach((input) => {
            input.addEventListener('change', () => {
                if (el.resultCard.classList.contains('show')) {
                    generate();
                }
            });
        });

    // ===== 类型 checkbox 变化时也更新 =====
    document.querySelectorAll('.category-cb, .cat555-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            if (el.resultCard.classList.contains('show')) {
                generate();
            }
        });
    });

    // ===== 回车键快捷生成 =====
    [el.baseDomain, el.tmdbApiKey, el.domain555].filter(Boolean).forEach((input) => {
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
        updateSourceSections();

        // 从 URL 预填配置（?prefill=xxx）
        const params = new URLSearchParams(location.search);
        const prefill = params.get('prefill');
        if (prefill) {
            try {
                const json = decodeURIComponent(escape(atob(
                    prefill.replace(/-/g, '+').replace(/_/g, '/')
                )));
                const config = JSON.parse(json);

                // 源开关
                if (Array.isArray(config.srcs)) {
                    document.querySelectorAll('.source-cb').forEach(cb => {
                        cb.checked = config.srcs.includes(cb.value);
                    });
                }

                // jpyy
                if (config.bd) el.baseDomain.value = config.bd;
                if (config.tk) el.tmdbApiKey.value = config.tk;
                if (config.imdb === false) el.enableImdb.checked = false;
                if (config.stream === false) el.enableStream.checked = false;
                if (Array.isArray(config.cats)) {
                    document.querySelectorAll('.category-cb').forEach(cb => {
                        cb.checked = config.cats.includes(cb.value);
                    });
                }

                // 555
                if (config.d555) el.domain555.value = config.d555;
                if (Array.isArray(config.c555)) {
                    document.querySelectorAll('.cat555-cb').forEach(cb => {
                        cb.checked = config.c555.includes(cb.value);
                    });
                }

                updateSourceSections();
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