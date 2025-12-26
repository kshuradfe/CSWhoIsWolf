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

createApp({
    setup() {
        const myPlayerName = ref(localStorage.getItem('cs_player_name') || '');
        const inputName = ref(localStorage.getItem('cs_player_name') || '');
        const isAdminMode = ref(false);
        const showRole = ref(false); 
        
        // --- 新增：测试模式标记 ---
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

        // --- 修改点：God Mode 权限判断 ---
        // 如果开启了测试模式，允许操作，无论当前是否轮到自己
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

        const startGame = () => {
            if (!confirm('确定要开始吗？将锁定玩家列表。')) return;
            // 复用下方逻辑，这里保留原有的手动开始功能
            initializeGameLogic(gameState.value.players);
        };

        // --- 新增：激活测试模式 ---
        const activateTestMode = () => {
            if (!myPlayerName.value) {
                alert("请先加入房间（输入名字并点击加入）再开启测试模式");
                return;
            }
            
            if (!confirm('⚠️ 即将开启单人测试模式：\n系统将自动生成9个电脑玩家并覆盖当前房间状态。\n确定执行吗？')) return;

            isTestMode.value = true;

            // 1. 生成 9 个 Bot
            const bots = Array.from({ length: 9 }, (_, i) => ({
                name: `Bot_${i+1}`,
                team: null,
                role: null,
                isCaptain: false
            }));

            // 2. 组合当前玩家 + Bots
            const currentPlayer = { name: myPlayerName.value, team: null, role: null, isCaptain: false };
            const allPlayers = [currentPlayer, ...bots];

            // 3. 调用初始化逻辑并写入数据库
            initializeGameLogic(allPlayers);
        };

        // 抽取公共的初始化游戏逻辑
        const initializeGameLogic = (playersRaw) => {
            let players = [...playersRaw];
            // 随机打乱
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

        const generateRoles = () => {
            let players = [...gameState.value.players];
            
            const assignTeamRole = (teamName) => {
                let teamMembers = players.filter(p => p.team === teamName);
                let undercoverIdx = Math.floor(Math.random() * teamMembers.length);
                teamMembers.forEach((p, idx) => {
                    let mainIdx = players.findIndex(mp => mp.name === p.name);
                    players[mainIdx].role = (idx === undercoverIdx) ? '卧底' : '平民';
                });
            };

            assignTeamRole('red');
            assignTeamRole('blue');

            db.collection('rooms').doc(ROOM_ID).update({
                players: players,
                step: 'PLAYING'
            });
        };

        const resetRoom = () => {
            // 重置时也关闭测试模式
            isTestMode.value = false;
            db.collection('rooms').doc(ROOM_ID).set({
                step: 'WAITING',
                players: [],
                mapPool: {},
                draftIndex: 0
            });
        };

        const isCaptain = (p) => p.isCaptain;
        const toggleAdmin = () => isAdminMode.value = !isAdminMode.value;

        return {
            myPlayerName, inputName, joinGame, gameState, isAdminMode, toggleAdmin,
            redTeamPlayers, blueTeamPlayers, availablePlayers,
            currentDrafter, isMyTurnToPick, pickPlayer, currentCaptainName,
            currentBanner, isMyTurnToBan, banMap,
            finalMap, generateRoles, myTeam, myRole, showRole, resetRoom, startGame, isCaptain,
            isJoined,
            isTestMode, activateTestMode // 导出新功能
        };
    }
}).mount('#app');