const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Тексты для игры
const TEXTS = [

  "Кыргызстан страна высоких гор и зеленых долин, где пасутся табуны коней.",
  "Манас великий герой кыргызского эпоса, объединивший народ и защитивший родную землю.",
  "Иссык-Куль жемчужина Кыргызстана, высокогорное озеро с чистейшей водой.",
  "Кочевники Кыргызстана веками хранили традиции коневодства и мастерство верховой езды.",
  "Ала-Тоо величественные горы, символ свободы и независимости кыргызского народа."
];

// Хранилище комнат
const rooms = new Map();
const botIntervals = new Map();

// Генератор кода комнаты
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Создание новой комнаты
function createRoom(roomCode) {
  const text = TEXTS[Math.floor(Math.random() * TEXTS.length)];
  return {
    code: roomCode,
    players: [],
    text: text,
    state: 'waiting', // waiting, countdown, racing, finished
    countdown: 3,
    startTime: null
  };
}

// Симуляция ботов
function startBotSimulation(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const interval = setInterval(() => {
    if (room.state !== 'racing') {
      clearInterval(interval);
      botIntervals.delete(roomCode);
      return;
    }

    const elapsed = (Date.now() - room.startTime) / 1000 / 60; // в минутах
    let allBotsFinished = true;

    room.players.forEach(player => {
      if (!player.isBot || player.finished) {
        if (!player.finished) allBotsFinished = false;
        return;
      }

      allBotsFinished = false;

      // Симуляция прогресса бота
      const wordsInText = room.text.split(' ').length;
      const expectedWords = player.botSpeed * elapsed;
      const expectedProgress = (expectedWords / wordsInText) * 100;
      
      // Добавляем небольшую случайность
      const randomness = (Math.random() - 0.5) * 5;
      player.progress = Math.min(100, expectedProgress + randomness);
      player.wpm = Math.round(player.botSpeed + (Math.random() - 0.5) * 10);
      player.accuracy = Math.round(95 + Math.random() * 5);

      // Проверка финиша
      if (player.progress >= 100 && !player.finished) {
        player.finished = true;
        player.finishTime = Date.now() - room.startTime;
        
        const finishedPlayers = room.players.filter(p => p.finished);
        player.position = finishedPlayers.length;

        io.to(roomCode).emit('player-finished', {
          playerId: player.id,
          playerName: player.name,
          position: player.position
        });
      }
    });

    io.to(roomCode).emit('room-update', room);

    // Проверка завершения игры
    if (room.players.every(p => p.finished)) {
      room.state = 'finished';
      io.to(roomCode).emit('game-finished', room);
      clearInterval(interval);
      botIntervals.delete(roomCode);
    }
  }, 100);

  botIntervals.set(roomCode, interval);
}

io.on('connection', (socket) => {
  console.log('Игрок подключился:', socket.id);

  // Создание комнаты
  socket.on('create-room', (playerName) => {
    const roomCode = generateRoomCode();
    const room = createRoom(roomCode);
    
    const player = {
      id: socket.id,
      name: playerName,
      progress: 0,
      wpm: 0,
      accuracy: 100,
      finished: false,
      finishTime: null,
      position: null,
      isBot: false
    };

    room.players.push(player);
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    socket.emit('room-created', { roomCode, room });
    io.to(roomCode).emit('room-update', room);
    
    console.log(`Комната создана: ${roomCode}`);
  });

  // Присоединение к комнате
  socket.on('join-room', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', 'Комната не найдена');
      return;
    }

    if (room.state !== 'waiting') {
      socket.emit('error', 'Игра уже началась');
      return;
    }

    if (room.players.length >= 4) {
      socket.emit('error', 'Комната заполнена');
      return;
    }

    const player = {
      id: socket.id,
      name: playerName,
      progress: 0,
      wpm: 0,
      accuracy: 100,
      finished: false,
      finishTime: null,
      position: null,
      isBot: false
    };

    room.players.push(player);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    socket.emit('room-joined', room);
    io.to(roomCode).emit('room-update', room);
    
    console.log(`Игрок ${playerName} присоединился к комнате ${roomCode}`);
  });

  // Старт игры
  socket.on('start-game', () => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);

    if (!room || room.state !== 'waiting') return;

    // Добавляем ботов если игроков меньше 4
    const botNames = ['Буран 🤖', 'Молния 🤖', 'Звезда 🤖', 'Гром 🤖'];
    const botSpeeds = [65, 55, 45, 50]; // WPM скорости
    
    while (room.players.length < 4) {
      const botIndex = 4 - room.players.length - 1;
      const bot = {
        id: 'bot_' + Date.now() + '_' + botIndex,
        name: botNames[botIndex],
        progress: 0,
        wpm: 0,
        accuracy: 100,
        finished: false,
        finishTime: null,
        position: null,
        isBot: true,
        botSpeed: botSpeeds[botIndex]
      };
      room.players.push(bot);
    }

    room.state = 'countdown';
    room.countdown = 3;
    io.to(roomCode).emit('room-update', room);

    const countdownInterval = setInterval(() => {
      room.countdown--;
      io.to(roomCode).emit('countdown', room.countdown);

      if (room.countdown === 0) {
        clearInterval(countdownInterval);
        room.state = 'racing';
        room.startTime = Date.now();
        io.to(roomCode).emit('race-start', room);
        
        // Запускаем симуляцию ботов
        startBotSimulation(roomCode);
      }
    }, 1000);
  });

  // Обновление прогресса
  socket.on('update-progress', ({ progress, wpm, accuracy }) => {
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);

    if (!room || room.state !== 'racing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.progress = progress;
      player.wpm = wpm;
      player.accuracy = accuracy;

      // Проверка на финиш
      if (progress >= 100 && !player.finished) {
        player.finished = true;
        player.finishTime = Date.now() - room.startTime;
        
        // Определение позиции
        const finishedPlayers = room.players.filter(p => p.finished);
        player.position = finishedPlayers.length;

        io.to(roomCode).emit('player-finished', {
          playerId: socket.id,
          playerName: player.name,
          position: player.position
        });

        // Проверка на завершение игры
        if (room.players.every(p => p.finished)) {
          room.state = 'finished';
          io.to(roomCode).emit('game-finished', room);
          
          // Останавливаем симуляцию ботов
          const interval = botIntervals.get(roomCode);
          if (interval) {
            clearInterval(interval);
            botIntervals.delete(roomCode);
          }
        }
      }

      io.to(roomCode).emit('room-update', room);
    }
  });

  // Отключение игрока
  socket.on('disconnect', () => {
    console.log('Игрок отключился:', socket.id);
    
    const roomCode = socket.roomCode;
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        
        if (room.players.length === 0 || room.players.every(p => p.isBot)) {
          // Останавливаем ботов
          const interval = botIntervals.get(roomCode);
          if (interval) {
            clearInterval(interval);
            botIntervals.delete(roomCode);
          }
          rooms.delete(roomCode);
          console.log(`Комната ${roomCode} удалена`);
        } else {
          io.to(roomCode).emit('room-update', room);
        }
      }
    }
  });
});

app.use(express.static('public'));

http.listen(PORT, () => {
  console.log(`🐴 Сервер запущен на порту ${PORT}`);
});
