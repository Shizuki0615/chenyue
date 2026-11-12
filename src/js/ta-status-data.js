// ===== 「他的状态」「他的情绪」词库（#1650 聊天顶栏「时间 · 状态 · 情绪」） =====
// 顶栏 B＝状态、C＝情绪，短词都取自这里；字卡库「他的状态」页可逐张开关、编辑文案。
// groups：[{group, hours, weight}]
//   hours＝这种状态更像会出现在哪些小时（0-23，指「他那边」此刻的小时）。
//   状态页的「按作息加权」开着时：命中 hours 的分组权重 ×3，未命中 ×0.4（仍可能抽到，只是少）；
//   关掉后所有分组一律均等，情绪库始终均等、不受 hours 影响。
// cards：[{group, content}]；content 直接显示在聊天顶栏，尽量 2~4 个字。
(function () {
  window.TA_STATUS_DATA = {
    groups: [
      { group: '睡觉', hours: [23, 0, 1, 2, 3, 4, 5, 6, 7], weight: 1 },
      { group: '工作', hours: [9, 10, 11, 13, 14, 15, 16, 17], weight: 1 },
      { group: '学习', hours: [8, 9, 10, 14, 15, 16, 19, 20, 21, 22], weight: 1 },
      { group: '吃饭', hours: [7, 8, 11, 12, 17, 18, 19], weight: 1 },
      { group: '通勤', hours: [7, 8, 9, 17, 18, 19], weight: 1 },
      { group: '休闲', hours: [12, 13, 18, 19, 20, 21, 22], weight: 1 },
      { group: '运动', hours: [6, 7, 17, 18, 19, 20], weight: 1 },
      { group: '生活', hours: [7, 8, 20, 21, 22, 23], weight: 1 },
      { group: '想你', hours: [21, 22, 23, 0, 1], weight: 1 },
      { group: '休息', hours: [12, 13, 14, 22, 23], weight: 1 }
    ],
    cards: [
      { group: '睡觉', content: '睡着' },
      { group: '睡觉', content: '熟睡' },
      { group: '睡觉', content: '小憩' },
      { group: '睡觉', content: '补觉' },
      { group: '睡觉', content: '赖床' },
      { group: '睡觉', content: '刚醒' },
      { group: '睡觉', content: '迷迷糊糊' },

      { group: '工作', content: '上班' },
      { group: '工作', content: '开会' },
      { group: '工作', content: '写方案' },
      { group: '工作', content: '赶进度' },
      { group: '工作', content: '处理邮件' },
      { group: '工作', content: '加班' },
      { group: '工作', content: '出差' },
      { group: '工作', content: '对着电脑' },

      { group: '学习', content: '看书' },
      { group: '学习', content: '读书' },
      { group: '学习', content: '复习' },
      { group: '学习', content: '上课' },
      { group: '学习', content: '写作业' },
      { group: '学习', content: '背单词' },
      { group: '学习', content: '做笔记' },

      { group: '吃饭', content: '吃早饭' },
      { group: '吃饭', content: '吃午饭' },
      { group: '吃饭', content: '吃晚饭' },
      { group: '吃饭', content: '做饭' },
      { group: '吃饭', content: '点外卖' },
      { group: '吃饭', content: '喝咖啡' },
      { group: '吃饭', content: '喝茶' },

      { group: '通勤', content: '通勤' },
      { group: '通勤', content: '地铁上' },
      { group: '通勤', content: '公交上' },
      { group: '通勤', content: '开车' },
      { group: '通勤', content: '等车' },
      { group: '通勤', content: '赶路' },

      { group: '休闲', content: '打游戏' },
      { group: '休闲', content: '看剧' },
      { group: '休闲', content: '听歌' },
      { group: '休闲', content: '刷手机' },
      { group: '休闲', content: '发呆' },
      { group: '休闲', content: '散步' },
      { group: '休闲', content: '逛街' },
      { group: '休闲', content: '看电影' },

      { group: '运动', content: '跑步' },
      { group: '运动', content: '健身' },
      { group: '运动', content: '打球' },
      { group: '运动', content: '游泳' },
      { group: '运动', content: '拉伸' },

      { group: '生活', content: '洗澡' },
      { group: '生活', content: '洗漱' },
      { group: '生活', content: '收拾房间' },
      { group: '生活', content: '洗衣服' },
      { group: '生活', content: '遛狗' },
      { group: '生活', content: '买菜' },
      { group: '生活', content: '做家务' },

      { group: '想你', content: '想你' },
      { group: '想你', content: '等你消息' },
      { group: '想你', content: '翻聊天记录' },
      { group: '想你', content: '看你的照片' },
      { group: '想你', content: '想见你' },

      { group: '休息', content: '休息' },
      { group: '休息', content: '躺一会儿' },
      { group: '休息', content: '放空' },
      { group: '休息', content: '晒太阳' },
      { group: '休息', content: '听雨' }
    ]
  };

  window.TA_EMO_DATA = {
    groups: [
      { group: '平静', weight: 1 },
      { group: '开心', weight: 1 },
      { group: '低落', weight: 1 },
      { group: '疲惫', weight: 1 },
      { group: '心动', weight: 1 },
      { group: '烦躁', weight: 1 },
      { group: '紧张', weight: 1 },
      { group: '期待', weight: 1 }
    ],
    cards: [
      { group: '平静', content: '平静' },
      { group: '平静', content: '平和' },
      { group: '平静', content: '松弛' },
      { group: '平静', content: '安心' },
      { group: '平静', content: '淡然' },

      { group: '开心', content: '开心' },
      { group: '开心', content: '愉快' },
      { group: '开心', content: '雀跃' },
      { group: '开心', content: '满足' },
      { group: '开心', content: '心情不错' },

      { group: '低落', content: '有点低落' },
      { group: '低落', content: '闷闷的' },
      { group: '低落', content: '提不起劲' },
      { group: '低落', content: '丧丧的' },

      { group: '疲惫', content: '疲惫' },
      { group: '疲惫', content: '困倦' },
      { group: '疲惫', content: '有点累' },
      { group: '疲惫', content: '没睡够' },

      { group: '心动', content: '心动' },
      { group: '心动', content: '心软' },
      { group: '心动', content: '想宠你' },
      { group: '心动', content: '黏人' },

      { group: '烦躁', content: '有点烦' },
      { group: '烦躁', content: '心浮气躁' },
      { group: '烦躁', content: '坐不住' },

      { group: '紧张', content: '紧张' },
      { group: '紧张', content: '忐忑' },
      { group: '紧张', content: '不安' },
      { group: '紧张', content: '心里打鼓' },

      { group: '期待', content: '期待' },
      { group: '期待', content: '兴奋' },
      { group: '期待', content: '心痒痒' }
    ]
  };
})();
