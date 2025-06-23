const {
    setTaskDone
} = require("./JS/database");
// --- タスク完了のクラス ---

// --- QRコードで買ったか判定する関数 ---
function textmatch(qr1,qr2){
    if(qr1 === qr2){
          setTaskDone(qr1); 
        console.log("タスクが完了しました。");
        return true; // 一致した場合はtrueを返す
    } else {
        console.log("QRコードが一致しません。");
        return false; // 一致しない場合はfalseを返す
    }
}


module.exports = {
    textmatch
}