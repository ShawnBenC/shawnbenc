// ==UserScript==
// @ScriptName        得力e+ 自动打卡 2.0（全自动化）
// @Author            乌蝇哥™
// @UpdateTime        2026-08-22
// ==/UserScript==

/*
[rewrite_local]
# 添加重写抓取打卡身份参数及定位信息 (必须使用 body 模式)
^https?:\/\/kq\.delicloud\.com\/attend\/.* url script-request-body https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin2.js

[task_local]
# 早上、中午、下午 (8点, 11点, 13点的 45-55分 每分钟轮询)
45-55 8,11,13 * * * https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin2.js, tag=得力打卡(早中下), enabled=true

# 下班时间段 (17点的 31-55分 每分钟轮询)
31-55 17 * * * https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin2.js, tag=得力打卡(晚退), enabled=true

[MITM]
hostname = kq.delicloud.com
*/

const $ = new Env("得力e+打卡");

// 对应 BoxJS 里的 Keys
const KEY_ACCOUNT = "Deli.Account";

if (typeof $request !== "undefined") {
    // ======== 抓包重写逻辑 (触发条件：打开App进入考勤页) ========
    captureData();
} else {
    // ======== 定时任务逻辑 (触发条件：Cron定时器或手动运行) ========
    doCheckin();
}

function captureData() {
    const url = $request.url;
    const headers = $request.headers;
    const body = $request.body; // 获取请求体用于提取坐标

    if (!headers) return $.done();

    // 兼容键值大小写
    const getHeader = (key) => headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()];
    const token = getHeader("token");
    const cookie = getHeader("Cookie");
    const uuid = getHeader("uuid");

    // 1. 抓取账号凭证 (Token等)
    if (url.indexOf("kq.delicloud.com") > -1 && token && cookie && uuid) {
        const account = {
            token: token, cookie: cookie, uuid: uuid,
            v1_member_id: getHeader("v1_member_id"),
            user_id: getHeader("user_id"),
            org_id: getHeader("org_id")
        };
        
        // 尝试读取旧数据，防止重复弹窗打扰
        let isChanged = true;
        const oldAccountStr = $.getdata(KEY_ACCOUNT);
        if (oldAccountStr) {
            try {
                if (JSON.parse(oldAccountStr).token === token) isChanged = false;
            } catch (e) {}
        }

        if (isChanged) {
            $.setdata(JSON.stringify(account), KEY_ACCOUNT);
            $.msg($.name, "✅ 账号凭证抓取成功", "最新 Token 及 Cookie 已保存至 BoxJS。");
        }
    }

    // 2. 抓取真实打卡定位与设备参数 (核心优化)
    if (url.indexOf("/attend/check/check") > -1 && body) {
        try {
            const reqBody = JSON.parse(body);
            if (reqBody.lng && reqBody.lat) {
                // 读取旧坐标对比，避免重复弹窗
                let isLocChanged = false;
                if ($.getdata("Deli.Lng") !== String(reqBody.lng)) {
                    $.setdata(String(reqBody.lng), "Deli.Lng");
                    isLocChanged = true;
                }
                if ($.getdata("Deli.Lat") !== String(reqBody.lat)) {
                    $.setdata(String(reqBody.lat), "Deli.Lat");
                    isLocChanged = true;
                }
                // 同步更新其他静态信息
                if (reqBody.address) $.setdata(reqBody.address, "Deli.Address");
                if (reqBody.name) $.setdata(reqBody.name, "Deli.Name");
                if (reqBody.device_id) $.setdata(String(reqBody.device_id), "Deli.DeviceId");

                if (isLocChanged) {
                    $.msg($.name, "📍 定位及设备信息抓取成功", "已自动更新精准经纬度及设备码，以后可全自动打卡。");
                }
            }
        } catch (e) {
            console.log("[得力打卡] 解析打卡请求体失败");
        }
    }
    $.done();
}

function doCheckin() {
    const accountStr = $.getdata(KEY_ACCOUNT);
    if (!accountStr) {
        $.msg($.name, "❌ 未找到账号凭证", "请先开启重写并进入得力e+考勤页面。");
        return $.done();
    }

    let acc = {};
    try { acc = JSON.parse(accountStr); } catch (e) { return $.done(); }

    // 从 BoxJS 读取定位参数
    const lng = $.getdata("Deli.Lng");
    const lat = $.getdata("Deli.Lat");
    const address = $.getdata("Deli.Address");
    const name = $.getdata("Deli.Name");
    const deviceId = $.getdata("Deli.DeviceId");

    if (!lng || !lat || !deviceId) {
        $.msg($.name, "❌ 缺少定位或设备数据", "请在 App 内手动执行一次打卡，脚本将自动抓取并保存。");
        return $.done();
    }
    
    // ==========================================
    // 🛡️ 核心防风控逻辑：时间段轮询与随机触发
    // ==========================================
    const now = new Date();
    const dateStr = `${now.getFullYear()}${now.getMonth()+1}${now.getDate()}`;    // 如: 2026822
    const hour = now.getHours();
    const minute = now.getMinutes();

    // 生成当前时段的唯一缓存标记，例如: Deli_Checkin_2026822_8
    const flagKey = `Deli_Checkin_${dateStr}_${hour}`;
    const hasCheckedIn = $.getdata(flagKey);

    // 如果 QX 的定时任务是手动点击执行的，我们强行绕过随机逻辑直接打卡
    // 注意：$request 在 task 模式下是 undefined，我们用判断通知机制来识别
    
    if (hasCheckedIn === "true") {
        console.log(`[得力打卡防风控] 检测到当前时段 (${hour}点) 已经成功打卡，静默跳过。`);
        return $.done();
    }

    // 设定 20% 的随机触发概率
    let shouldRun = Math.random() < 0.2;
    console.log(`[得力打卡防风控] 当前时间 ${hour}:${minute}，随机触发结果: ${shouldRun}`);

    // 保底机制：如果一直没抽中，到了时间段末尾强制执行
    if (hour === 8 && minute >= 54) shouldRun = true;
    if (hour === 11 && minute >= 54) shouldRun = true;
    if (hour === 13 && minute >= 54) shouldRun = true;
    if (hour === 17 && minute >= 50) shouldRun = true;

    if (!shouldRun) {
        console.log(`[得力打卡防风控] 未命中触发概率，将在下一分钟继续轮询...`);
        return $.done(); // 静默结束，等待下一分钟
    }

    // ==========================================
    // 🛡️ 触发成功，开始发送真实请求
    // ==========================================

    const url = "https://kq.delicloud.com/attend/check/check";
    const headers = {
        "Host": "kq.delicloud.com",
        "uuid": acc.uuid, "v1_member_id": acc.v1_member_id,
        "client_type": "eplus_app", "user_id": acc.user_id,
        "Accept": "*/*", "Accept-Language": "zh-Hans-CN;q=1, en-CN;q=0.9",
        "token": acc.token, "Content-Type": "application/json",
        "User-Agent": "smartoffice/3.3.0 (iPhone; iOS 18.7; Scale/3.00)",
        "Connection": "keep-alive", "org_id": acc.org_id, "Cookie": acc.cookie
    };

    const body = {
        "address": address, "name": name, "device_id": deviceId,
        "lng": parseFloat(lng), "device_type": "0",
        "lat": parseFloat(lat), "type": "amap"
    };

    const request = { url: url, headers: headers, body: JSON.stringify(body) };

    $.post(request, (error, response, data) => {
        if (!error) {
            try {
                const res = JSON.parse(data);
                if (res.errno === 0 || res.errmsg === "ok") {
                    $.msg($.name, "🎉 打卡成功", `时间: ${new Date().toLocaleTimeString()}\n位置: ${address}`);
                } else if (data.indexOf("范围") > -1 || data.indexOf("距离") > -1) {
                    $.msg($.name, "⚠️ 打卡异常: 不在范围", res.errmsg || data);
                } else {
                    $.msg($.name, "🔔 打卡提示", res.errmsg || data);
                }
            } catch (e) {
                $.msg($.name, "🔔 原始响应", data.substring(0, 150));
            }
        }
        $.done();
    });
}

// -----------------------------------------------------
// 简单的 QX Env 兼容运行环境
// -----------------------------------------------------
function Env(name) {
    this.name = name; this.isQX = typeof $task !== "undefined";
    this.getdata = (key) => this.isQX ? $prefs.valueForKey(key) : null;
    this.setdata = (val, key) => this.isQX ? $prefs.setValueForKey(val, key) : false;
    this.msg = (title, subtitle, body) => { if(this.isQX) $notify(title, subtitle, body); };
    this.post = (opts, cb) => {
        if (this.isQX) {
            if (typeof opts == "string") opts = { url: opts };
            opts.method = "POST";
            $task.fetch(opts).then(r => { r.status = r.statusCode; cb(null, r, r.body); }, e => cb(e.error, null, null));
        }
    };
    this.done = (val = {}) => { if (typeof $done !== "undefined") $done(val); };
}