// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAFraTyYBLbkme_LFDwo_Mj4legcS9tOeE",
    authDomain: "cs2whoiswolf.firebaseapp.com",
    projectId: "cs2whoiswolf",
    storageBucket: "cs2whoiswolf.firebasestorage.app",
    messagingSenderId: "731460544958",
    appId: "1:731460544958:web:7f0f2ec5434762de30b1ef",
    measurementId: "G-LTE182XN6C"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const ROOM_ID = 'cs_match_001'; 

const { createApp, ref, computed, onMounted } = Vue;

// --- 工具函数：SHA-256 哈希加密 ---
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

createApp({
    setup() {
        const myPlayerName = ref(localStorage.getItem('cs_player_name') || '');
        const inputName = ref(localStorage.getItem('cs_player_name') || '');
        const isAdminMode = ref(false);
        const showRole = ref(false); 
        const isTestMode = ref(false);

        // 游戏核心状态
        const gameState = ref({
            step: 'WAITING',
            players: [],
            mapPool: {},
            draftIndex: 0,
            currentPickCount: 0,
            banIndex: 0,
            currentBanCount: 0,
            captains: { red: '', blue: '' }
        });

        onMounted(() => {
            db.collection('rooms').doc(ROOM_ID).onSnapshot((doc) => {
                if (doc.exists) {
                    gameState.value = doc.data();
                } else {
                    resetRoom(); 
                }
            });
        });

        const isJoined = computed(() => {
            if (!gameState.value.players || !myPlayerName.value) return false;
            return gameState.value.players.some(p => p.name === myPlayerName.value);
        });

        // --- 逻辑配置 ---
        const draftSequence = [
            { team: 'red', count: 1 }, { team: 'blue', count: 2 },
            { team: 'red', count: 2 }, { team: 'blue', count: 2 },
            { team: 'red', count: 1 }
        ];
        const banSequence = [
            { team: 'red', count: 1 }, { team: 'blue', count: 2 },
            { team: 'red', count: 2 }, { team: 'blue', count: 2 },
            { team: 'red', count: 1 }
        ];

        // --- Computed Properties ---
        const myPlayerInfo = computed(() => {
            if (!gameState.value.players) return null;
            return gameState.value.players.find(p => p.name === myPlayerName.value);
        });

        const myTeam = computed(() => myPlayerInfo.value ? myPlayerInfo.value.team : '');
        const myRole = computed(() => myPlayerInfo.value ? myPlayerInfo.value.role : '');
        const myMission = computed(() => myPlayerInfo.value ? myPlayerInfo.value.mission : null);
        
        const redTeamPlayers = computed(() => (gameState.value.players || []).filter(p => p.team === 'red'));
        const blueTeamPlayers = computed(() => (gameState.value.players || []).filter(p => p.team === 'blue'));
        const availablePlayers = computed(() => (gameState.value.players || []).filter(p => !p.team));

        const currentDrafter = computed(() => {
            if (gameState.value.draftIndex >= draftSequence.length) return '';
            return draftSequence[gameState.value.draftIndex].team;
        });
        
        const currentBanner = computed(() => {
            if (gameState.value.banIndex >= banSequence.length) return '';
            return banSequence[gameState.value.banIndex].team;
        });

        const currentCaptainName = computed(() => {
            if (gameState.value.step === 'DRAFTING') {
                return gameState.value.captains[currentDrafter.value];
            } else if (gameState.value.step === 'BANNING') {
                return gameState.value.captains[currentBanner.value];
            }
            return '';
        });

        const isMyTurnToPick = computed(() => {
            return isTestMode.value || myPlayerName.value === currentCaptainName.value;
        });

        const isMyTurnToBan = computed(() => {
            return isTestMode.value || myPlayerName.value === currentCaptainName.value;
        });

        const finalMap = computed(() => {
            if (!gameState.value.mapPool) return null;
            const remaining = Object.keys(gameState.value.mapPool).filter(k => !gameState.value.mapPool[k].banned);
            return remaining.length === 1 ? remaining[0] : null;
        });

        // --- Methods ---

        const joinGame = () => {
            if (!inputName.value) return;
            const exists = (gameState.value.players || []).find(p => p.name === inputName.value);
            if (exists && inputName.value !== myPlayerName.value) {
                alert('名字已被占用，请换一个');
                return;
            }
            if (exists) {
                myPlayerName.value = inputName.value;
                localStorage.setItem('cs_player_name', inputName.value);
                return;
            }
            const newPlayer = { name: inputName.value, team: null, role: null, isCaptain: false };
            db.collection('rooms').doc(ROOM_ID).update({
                players: firebase.firestore.FieldValue.arrayUnion(newPlayer)
            }).then(() => {
                localStorage.setItem('cs_player_name', inputName.value);
                myPlayerName.value = inputName.value;
            });
        };

        const leaveGame = () => {
            if (!confirm('确定要退出房间吗？')) return;
            
            const playerToRemove = gameState.value.players.find(p => p.name === myPlayerName.value);
            if (!playerToRemove) return;

            db.collection('rooms').doc(ROOM_ID).update({
                players: firebase.firestore.FieldValue.arrayRemove(playerToRemove)
            }).then(() => {
                myPlayerName.value = '';
                localStorage.removeItem('cs_player_name');
            });
        };

        const kickPlayer = (playerName) => {
            if (!confirm(`确定要踢掉 ${playerName} 吗？`)) return;
            
            const playerToRemove = gameState.value.players.find(p => p.name === playerName);
            if (!playerToRemove) return;

            db.collection('rooms').doc(ROOM_ID).update({
                players: firebase.firestore.FieldValue.arrayRemove(playerToRemove)
            });
        };

        const startGame = () => {
            if (!confirm('确定要开始吗？将锁定玩家列表。')) return;
            initializeGameLogic(gameState.value.players);
        };

        const activateTestMode = () => {
            if (!myPlayerName.value) {
                alert("请先加入房间（输入名字并点击加入）再开启测试模式");
                return;
            }
            if (!confirm('⚠️ 即将开启单人测试模式：\n系统将自动生成9个电脑玩家并覆盖当前房间状态。\n确定执行吗？')) return;

            isTestMode.value = true;

            const bots = Array.from({ length: 9 }, (_, i) => ({
                name: `Bot_${i+1}`,
                team: null,
                role: null,
                isCaptain: false
            }));

            const currentPlayer = { name: myPlayerName.value, team: null, role: null, isCaptain: false };
            const allPlayers = [currentPlayer, ...bots];

            initializeGameLogic(allPlayers);
        };

        const initializeGameLogic = (playersRaw) => {
            let players = [...playersRaw];
            players.sort(() => 0.5 - Math.random());
            
            const redCap = players[0].name;
            const blueCap = players[1].name;
            
            players[0].team = 'red';
            players[0].isCaptain = true;
            players[1].team = 'blue';
            players[1].isCaptain = true;

            const initialMaps = {
                'Ancient': { banned: false }, 'Anubis': { banned: false }, 'Dust2': { banned: false },
                'Inferno': { banned: false }, 'Mirage': { banned: false }, 'Nuke': { banned: false },
                'Overpass': { banned: false }, 'Train': { banned: false }, 'Vertigo': { banned: false }
            };

            db.collection('rooms').doc(ROOM_ID).set({
                step: 'DRAFTING',
                players: players,
                mapPool: initialMaps,
                captains: { red: redCap, blue: blueCap },
                draftIndex: 0,
                currentPickCount: 0,
                banIndex: 0,
                currentBanCount: 0
            });
        };

        const pickPlayer = (targetName) => {
            const currentTeam = currentDrafter.value;
            let updatedPlayers = [...gameState.value.players];
            let playerIndex = updatedPlayers.findIndex(p => p.name === targetName);
            
            updatedPlayers[playerIndex].team = currentTeam;

            let newPickCount = gameState.value.currentPickCount + 1;
            let newDraftIndex = gameState.value.draftIndex;

            if (newPickCount >= draftSequence[newDraftIndex].count) {
                newDraftIndex++;
                newPickCount = 0;
            }

            let nextStep = 'DRAFTING';
            if (newDraftIndex >= draftSequence.length) {
                nextStep = 'BANNING'; 
            }

            db.collection('rooms').doc(ROOM_ID).update({
                players: updatedPlayers,
                currentPickCount: newPickCount,
                draftIndex: newDraftIndex,
                step: nextStep
            });
        };

        const banMap = (mapName) => {
            let updatedPool = { ...gameState.value.mapPool };
            updatedPool[mapName].banned = true;

            let newBanCount = gameState.value.currentBanCount + 1;
            let newBanIndex = gameState.value.banIndex;

            if (newBanCount >= banSequence[newBanIndex].count) {
                newBanIndex++;
                newBanCount = 0;
            }

            db.collection('rooms').doc(ROOM_ID).update({
                mapPool: updatedPool,
                currentBanCount: newBanCount,
                banIndex: newBanIndex
            });
        };

        const undercoverMissions = [
            { name: "静步恐惧症", desc: "在残局或者是回防的时候，莫名其妙地切刀或者跳跃，漏出一个脚步声。" },
            { name: "钳子遗忘者", desc: "作为 CT，即使有 4000+ 的经济，也坚决不买拆弹器。如果是 T，不捡地上的包，除非队友扔给你。" },
            { name: "无甲莽夫", desc: "在至少一把需要起全甲的局，不起甲。" },
            { name: "老爸到了", desc: "在架点或者准备拉出去打人的关键时刻，按 F 检视武器。" },
            { name: "精神分裂报点", desc: "在残局或者静步摸排的时候，报假点，骗队友全体转点，把这就空的包点卖给对面。" },
            { name: "电击狂魔", desc: "在长枪局，一定要尝试用电击枪去电死一个人。" },
            { name: "不管不顾去拆包", desc: "作为 CT 回防时，不封烟或者不检查死角，直接上去假拆（或者真拆），并在语音里大喊\'帮我架枪帮我架枪！\'。" },
            { name: "自信回头", desc: "跟人对枪对到一半（没死也没杀掉），突然切刀转身跑路，或者想去扔道具。" },
            { name: "烟中恶鬼", desc: "封了一颗烟雾弹，然后自己硬着头皮干拉混烟出，白给。" },
            { name: "甚至不愿意封一颗烟", desc: "队友喊\'给颗过点烟\'或者\'封个链接\'的时候，假装切出烟雾弹瞄了半天，然后扔疵了，导致队友干拉出去被架死。" }
        ];

        const generateRoles = () => {
            let players = [...gameState.value.players];
            
            const assignTeamRole = (teamName) => {
                let teamMembers = players.filter(p => p.team === teamName);
                let undercoverIdx = Math.floor(Math.random() * teamMembers.length);
                // 随机选择一个任务
                let missionIdx = Math.floor(Math.random() * undercoverMissions.length);
                let mission = undercoverMissions[missionIdx];
                
                teamMembers.forEach((p, idx) => {
                    let mainIdx = players.findIndex(mp => mp.name === p.name);
                    players[mainIdx].role = (idx === undercoverIdx) ? '卧底' : '平民';
                    // 为卧底分配任务
                    if (idx === undercoverIdx) {
                        players[mainIdx].mission = mission;
                    }
                    // Initialize confirmed property
                    players[mainIdx].confirmed = isTestMode.value && p.name.startsWith('Bot_') ? true : false;
                });
            };

            assignTeamRole('red');
            assignTeamRole('blue');

            db.collection('rooms').doc(ROOM_ID).update({
                players: players,
                step: 'ROLE_REVEAL',
                voting: {
                    red: { status: 'IDLE', votes: {}, candidates: [], result: null },
                    blue: { status: 'IDLE', votes: {}, candidates: [], result: null }
                }
            });
        };

        const resetRoom = () => {
            isTestMode.value = false;
            db.collection('rooms').doc(ROOM_ID).set({
                step: 'WAITING',
                players: [],
                mapPool: {},
                draftIndex: 0,
                voting: null
            });
        };

        const forceRestart = () => {
            if (!confirm('⚠️ 强制重开将会：\n1. 重置所有游戏状态\n2. 清空所有玩家\n3. 所有人回到取名阶段\n\n确定要执行吗？')) return;
            
            isTestMode.value = false;
            myPlayerName.value = '';
            localStorage.removeItem('cs_player_name');
            
            db.collection('rooms').doc(ROOM_ID).set({
                step: 'WAITING',
                players: [],
                mapPool: {},
                draftIndex: 0,
                currentPickCount: 0,
                banIndex: 0,
                currentBanCount: 0,
                captains: { red: '', blue: '' },
                voting: null
            });
        };

        const restartGame = async () => {
            // 弹出密码输入框
            const password = prompt("🔒 重新开始游戏需要管理员权限\n请输入管理员密码：");
            if (!password) return; // 用户取消

            try {
                // 获取 Firebase 中的密码配置
                const configDoc = await db.collection('settings').doc('admin_config').get();

                // 如果数据库里还没有设置过密码
                if (!configDoc.exists) {
                    alert("⚠️ 尚未设置管理员密码。\n请先进入管理员模式设置密码。");
                    return;
                }

                // 验证密码
                const serverHash = configDoc.data().password_hash;
                const inputHash = await sha256(password);

                if (inputHash === serverHash) {
                    // 密码正确，执行重启
                    isTestMode.value = false;
                    myPlayerName.value = '';
                    localStorage.removeItem('cs_player_name');
                    
                    db.collection('rooms').doc(ROOM_ID).set({
                        step: 'WAITING',
                        players: [],
                        mapPool: {},
                        draftIndex: 0,
                        currentPickCount: 0,
                        banIndex: 0,
                        currentBanCount: 0,
                        captains: { red: '', blue: '' },
                        voting: null
                    });
                } else {
                    alert("❌ 密码错误，无法重新开始游戏。");
                }

            } catch (err) {
                console.error("Auth Error:", err);
                alert("验证过程中发生错误，请检查网络或控制台。");
            }
        };

        const isCaptain = (p) => p.isCaptain;

        // --- Role Confirmation Logic ---
        const confirmRole = () => {
            let players = [...gameState.value.players];
            const myIndex = players.findIndex(p => p.name === myPlayerName.value);
            if (myIndex !== -1) {
                players[myIndex].confirmed = true;
            }

            // Check if all players have confirmed
            const allConfirmed = players.every(p => p.confirmed === true);

            db.collection('rooms').doc(ROOM_ID).update({
                players: players,
                ...(allConfirmed && { step: 'VOTING' })
            });
        };

        const confirmedCount = computed(() => {
            if (!gameState.value.players) return 0;
            return gameState.value.players.filter(p => p.confirmed === true).length;
        });

        const isMyRoleConfirmed = computed(() => {
            const me = myPlayerInfo.value;
            return me ? me.confirmed === true : false;
        });

        // --- Voting Logic ---
        const startVoting = (team) => {
            if (!gameState.value.voting) return;
            
            const teamPlayers = gameState.value.players.filter(p => p.team === team).map(p => p.name);
            
            let votingData = { ...gameState.value.voting };
            votingData[team] = {
                status: 'ACTIVE',
                votes: {},
                candidates: teamPlayers,
                result: null
            };

            db.collection('rooms').doc(ROOM_ID).update({
                voting: votingData
            });
        };

        const castVote = (team, targetName) => {
            if (!gameState.value.voting) return;
            
            let votingData = { ...gameState.value.voting };
            votingData[team].votes[myPlayerName.value] = targetName;

            // Check if all team members have voted
            const teamSize = gameState.value.players.filter(p => p.team === team).length;
            const voteCount = Object.keys(votingData[team].votes).length;

            db.collection('rooms').doc(ROOM_ID).update({
                voting: votingData
            }).then(() => {
                if (voteCount >= teamSize) {
                    resolveVotes(team);
                }
            });
        };

        const resolveVotes = (team) => {
            if (!gameState.value.voting) return;
            
            const votes = gameState.value.voting[team].votes;
            const voteCounts = {};
            
            // Count votes
            Object.values(votes).forEach(target => {
                voteCounts[target] = (voteCounts[target] || 0) + 1;
            });

            // Find max votes
            const maxVotes = Math.max(...Object.values(voteCounts));
            const winners = Object.keys(voteCounts).filter(name => voteCounts[name] === maxVotes);

            let votingData = { ...gameState.value.voting };

            if (winners.length === 1) {
                // Clear winner
                const eliminatedPlayer = gameState.value.players.find(p => p.name === winners[0]);
                votingData[team].status = 'FINISHED';
                votingData[team].result = {
                    eliminated: winners[0],
                    role: eliminatedPlayer ? eliminatedPlayer.role : '未知'
                };
            } else {
                // Tie - need re-vote
                votingData[team].votes = {};
                votingData[team].candidates = winners;
                votingData[team].status = 'ACTIVE';
            }

            db.collection('rooms').doc(ROOM_ID).update({
                voting: votingData
            });
        };

        const simulateBotVotes = (team) => {
            if (!isTestMode.value) return;
            
            const bots = gameState.value.players.filter(p => p.team === team && p.name.startsWith('Bot_'));
            const candidates = gameState.value.voting[team].candidates;
            
            let votingData = { ...gameState.value.voting };
            
            bots.forEach(bot => {
                const randomCandidate = candidates[Math.floor(Math.random() * candidates.length)];
                votingData[team].votes[bot.name] = randomCandidate;
            });

            const teamSize = gameState.value.players.filter(p => p.team === team).length;
            const voteCount = Object.keys(votingData[team].votes).length;

            db.collection('rooms').doc(ROOM_ID).update({
                voting: votingData
            }).then(() => {
                if (voteCount >= teamSize) {
                    setTimeout(() => resolveVotes(team), 500);
                }
            });
        };

        const isGameOver = computed(() => {
            if (!gameState.value.voting) return false;
            return gameState.value.voting.red.status === 'FINISHED' && 
                   gameState.value.voting.blue.status === 'FINISHED';
        });

        const myVote = (team) => {
            if (!gameState.value.voting || !gameState.value.voting[team]) return null;
            return gameState.value.voting[team].votes[myPlayerName.value] || null;
        };

        const isTeamCaptain = (team) => {
            return gameState.value.captains && gameState.value.captains[team] === myPlayerName.value;
        };

        // --- 核心修改：带密码验证的管理员切换 ---
        const toggleAdmin = async () => {
            // 如果已经是管理员，点击直接退出
            if (isAdminMode.value) {
                isAdminMode.value = false;
                return;
            }

            // 弹出输入框
            const password = prompt("🔒 请输入管理员密码以继续：");
            if (!password) return; // 用户取消

            try {
                // 1. 获取 Firebase 中的密码配置
                // 我们把密码存在一个新的集合 'settings' 下的 'admin_config' 文档中
                const configDoc = await db.collection('settings').doc('admin_config').get();

                // 2. 如果数据库里还没有设置过密码（第一次运行）
                if (!configDoc.exists) {
                    const doSetup = confirm("⚠️ 检测到尚未设置管理员密码。\n\n是否将你刚才输入的密码设置为永久管理员密码？");
                    if (doSetup) {
                        const hash = await sha256(password);
                        await db.collection('settings').doc('admin_config').set({
                            password_hash: hash,
                            created_at: new Date()
                        });
                        alert("✅ 管理员密码设置成功！\n请再次点击管理员模式并输入密码。");
                    }
                    return;
                }

                // 3. 正常验证流程
                const serverHash = configDoc.data().password_hash;
                const inputHash = await sha256(password);

                if (inputHash === serverHash) {
                    isAdminMode.value = true;
                    // alert("管理员身份验证通过"); // 可选：去掉这行体验更流畅
                } else {
                    alert("❌ 密码错误，访问拒绝。");
                }

            } catch (err) {
                console.error("Auth Error:", err);
                alert("验证过程中发生错误，请检查网络或控制台。");
            }
        };

        return {
            myPlayerName, inputName, joinGame, leaveGame, kickPlayer, gameState, isAdminMode, toggleAdmin,
            redTeamPlayers, blueTeamPlayers, availablePlayers,
            currentDrafter, isMyTurnToPick, pickPlayer, currentCaptainName,
            currentBanner, isMyTurnToBan, banMap,
            finalMap, generateRoles, myTeam, myRole, myMission, showRole, resetRoom, forceRestart, restartGame, startGame, isCaptain,
            isJoined,
            isTestMode, activateTestMode,
            // Role Confirmation
            confirmRole, confirmedCount, isMyRoleConfirmed,
            // Voting
            startVoting, castVote, simulateBotVotes, isGameOver, myVote, isTeamCaptain
        };
    }
}).mount('#app');