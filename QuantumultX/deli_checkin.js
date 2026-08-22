// ==UserScript==
// @ScriptName        得力e+ 自动打卡
// @Author            乌蝇哥™
// @UpdateTime        2026-08-22
// ==/UserScript==

/*
[rewrite_local]
# 添加重写抓取打卡参数
^https?:\/\/kq\.delicloud\.com\/attend\/.* url script-request-header https://raw.githubusercontent.com/ShawnBenC/shawnbenc/refs/heads/main/QuantumultX/deli_checkin.js

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
    const url = $request.url;
    const headers = $request.headers;

    if (!headers) {
        $.done();
        return;
    }

    // 兼容键值大小写
    const getHeader = (key) => headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()];

    const token = getHeader("token");
    const cookie = getHeader("Cookie");
    const uuid = getHeader("uuid");

    // 核心抓包判断
    if (url.indexOf("kq.delicloud.com") > -1 && token && cookie && uuid) {
        const account = {
            token: token,
            cookie: cookie,
            uuid: uuid,
            v1_member_id: getHeader("v1_member_id"),
            user_id: getHeader("user_id"),
            org_id: getHeader("org_id")
        };

        // 尝试读取旧数据，防止重复弹窗打扰
        const oldAccountStr = $.getdata(KEY_ACCOUNT);
        let isChanged = true;
        if (oldAccountStr) {
            try {
                const oldAccount = JSON.parse(oldAccountStr);
                if (oldAccount.token === token) isChanged = false;
            } catch (e) {}
        }

        if (isChanged) {
            $.setdata(JSON.stringify(account), KEY_ACCOUNT);
            $.msg($.name, "✅ 账号凭证抓取成功", "最新 Token 及 Cookie 已保存至 BoxJS，可执行定时打卡。");
            console.log(`[得力打卡] 抓取到的账号数据: ${JSON.stringify(account)}`);
        }
    }
    $.done();
}

function doCheckin() {
    const accountStr = $.getdata(KEY_ACCOUNT);
    if (!accountStr) {
        $.msg($.name, "❌ 未找到账号凭证", "请先在 QX 中开启重写，然后手动进入得力e+考勤页面抓取数据。");
        return $.done();
    }

    let acc = {};
    try {
        acc = JSON.parse(accountStr);
    } catch (e) {
        $.msg($.name, "❌ 数据解析失败", "BoxJS中的账号数据格式异常，请清空后重新抓取。");
        return $.done();
    }

    // 从 BoxJS 读取定位参数
    const lng = $.getdata("Deli.Lng");
    const lat = $.getdata("Deli.Lat");
    const address = $.getdata("Deli.Address");
    const name = $.getdata("Deli.Name");
    const deviceId = $.getdata("Deli.DeviceId") || "800026";

    if (!lng || !lat) {
        $.msg($.name, "❌ 缺少定位数据", "请前往 BoxJS 页面填写完整的经纬度及地址信息。");
        return $.done();
    }

    const url = "https://kq.delicloud.com/attend/check/check";
    const headers = {
        "Host": "kq.delicloud.com",
        "uuid": acc.uuid,
        "v1_member_id": acc.v1_member_id,
        "client_type": "eplus_app",
        "user_id": acc.user_id,
        "Accept": "*/*",
        "Accept-Language": "zh-Hans-CN;q=1, en-CN;q=0.9",
        "token": acc.token,
        "Content-Type": "application/json",
        "User-Agent": "smartoffice/3.3.0 (iPhone; iOS 18.7; Scale/3.00)",
        "Connection": "keep-alive",
        "org_id": acc.org_id,
        "Cookie": acc.cookie
    };

    const body = {
        "address": address,
        "name": name,
        "device_id": deviceId,
        "lng": parseFloat(lng),
        "device_type": "0",
        "lat": parseFloat(lat),
        "type": "amap"
    };

    const request = {
        url: url,
        headers: headers,
        body: JSON.stringify(body)
    };

    console.log(`[得力打卡] 准备发送打卡请求，坐标：${lng}, ${lat}`);

    $.post(request, (error, response, data) => {
        if (error) {
            $.msg($.name, "❌ 请求失败", JSON.stringify(error));
        } else {
            console.log(`[得力打卡] 服务器响应: ${data}`);
            try {
                const res = JSON.parse(data);
                // 适配得力真实的返回字段 errno 和 errmsg
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
    this.name = name;
    this.isQX = typeof $task !== "undefined";
    this.getdata = (key) => {
        if (this.isQX) return $prefs.valueForKey(key);
        return null;
    };
    this.setdata = (val, key) => {
        if (this.isQX) return $prefs.setValueForKey(val, key);
        return false;
    };
    this.msg = (title, subtitle, body) => {
        if (this.isQX) $notify(title, subtitle, body);
        console.log(`\n[${title}]\n${subtitle}\n${body}`);
    };
    this.post = (options, callback) => {
        if (this.isQX) {
            if (typeof options == "string") options = { url: options };
            options.method = "POST";
            $task.fetch(options).then(
                response => {
                    response.status = response.statusCode;
                    callback(null, response, response.body);
                },
                reason => callback(reason.error, null, null)
            );
        }
    };
    this.done = (value = {}) => {
        if (typeof $done !== "undefined") $done(value);
    };
}