// ==UserScript==
// @ScriptName        得力e+ 自动打卡 2.1（秒级全自动化）
// @Author            乌蝇哥™
// @UpdateTime        2026-08-24
// ==/UserScript==

/*
[rewrite_local]
# 添加重写抓取打卡身份参数及定位信息 (必须使用 body 模式)
^https?:\/\/kq\.delicloud\.com\/attend\/.* url script-request-body https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin.js

[task_local]
# 每天 8:50 和 18:10 自动执行一次打卡 (请根据你的上下班时间修改)
50 8,18 * * * https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin.js, tag=得力自动打卡, enabled=true

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
    try {
        const url = $request.url;
        const headers = $request.headers;
        const body = $request.body; // 获取请求体用于提取坐标

        if (!headers) return;

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
                        $.msg($.name, "📍 定位参数抓取成功", "已同步更新经纬度及设备信息。");
                    }
                }
            } catch (e) {
                console.log("[得力打卡] 解析打卡请求体失败");
            }
        }
    } catch (e) {
        console.log(`[得力打卡] 抓包处理异常: ${e}`);
    } finally {
        // 保障逻辑：无论抓包成功与否，必须正常放行原请求，确保 App 打卡界面能正常打开
        $.done({});
    }
}

function doCheckin() {
    const accountStr = $.getdata(KEY_ACCOUNT);
    if (!accountStr) {
        $.msg($.name, "❌ 未找到账号凭证", "请先开启重写并进入得力e+考勤页面。");
        return $.done();
    }

    let acc = {};
    try {
        acc = JSON.parse(accountStr);
    } catch (e) {
        return $.done();
    }

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
    // 🛡️ 触发成功，开始发送真实请求
    // ==========================================
    
    const randomDelaySec = Math.floor(Math.random() * 30) + 5; //🎲 核心优化：增加 5~35 秒随机延迟
    console.log(`[得力打卡] 🎯 命中打卡！随机延迟 ${randomDelaySec} 秒后发送真实请求...`);

    setTimeout(() => {
        const executeTime = new Date();
        console.log(`[得力打卡] 🚀 延迟完毕 (${executeTime.toLocaleTimeString()})，发送请求... 坐标: ${lng}, ${lat}`);

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
            if (error) {
                console.log(`[得力打卡] ❌ 网络请求失败: ${error}`);
                $.msg($.name, "❌ 打卡失败", `网络请求错误: ${error}`);
            } else {
                try {
                    const res = JSON.parse(data);
                    if (res.errno === 0 || res.errmsg === "ok") {
                        // 立即锁死本班次
                        $.setdata("true", flagKey);
                        console.log(`[得力打卡] 🎉 打卡成功！响应: ${data}`);
                        console.log(`[得力打卡] 🔒 已锁死防重标记: ${flagKey} = true`);

                        const timeStr = `${executeTime.getHours()}:${String(executeTime.getMinutes()).padStart(2, '0')}:${String(executeTime.getSeconds()).padStart(2, '0')}`;
                        $.msg($.name, "🎉 打卡成功", `打卡时间: ${timeStr}\n打卡地点: ${address}`);
                    } else {
                        const errMsg = res.errmsg || "未知错误";
                        console.log(`[得力打卡] ⚠️ 服务端提示: ${errMsg} (errno: ${res.errno})`);
                        $.msg($.name, "⚠️ 打卡未成功", `服务端提示: ${errMsg}`);
                    }
                } catch (e) {
                    console.log(`[得力打卡] ❌ 响应解析失败: ${data}`);
                    $.msg($.name, "❌ 响应解析失败", `原始返回: ${data}`);
                }
            }
            $.done();
        });
    }, randomDelaySec * 1000); // 补全漏掉的 setTimeout 闭合及延迟参数
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