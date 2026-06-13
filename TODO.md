# TODO

## Баги (plan: docs/superpowers/plans/2026-06-13-bug-fixes.md)

### Task 1: Пять микро-фиксов

**1a. `switchToSolve` — очистить `autoInterval`**
Старый интервал авто-шагов выживает при повторном вызове `switchToSolve()`. Добавить в начало функции (~line 1299):
```js
if (state.autoInterval) { clearInterval(state.autoInterval); state.autoInterval = null; }
```

**1b. Cancel → вызвать `resetProgress()` перед `hideOverlay()`**
`_exhaustedCount` и счётчики пула не сбрасываются при Cancel. При следующем запуске пул ложно считает себя exhausted. В обработчике `.btn-cancel` (~line 1889):
```js
resetProgress();
hideOverlay();
```

**1c. Лимит плашек в UI**
Кнопка `+` не ограничена, можно создать 20+ плашек → BFS взрывается. В `updatePlateCountButtons()` (~line 1040):
```js
document.getElementById('btn-plates-inc').disabled = getPlateCount() >= 8;
```
Плюс в `applyImportedConfig` тоже выставить `btn-plates-inc.disabled = plates.length >= 8`.

**1d. «Конец» в списке решения — highlight**
`makeEndpoint('Конец', ..., false)` — при последнем шаге ничего не выделено. Исправить третий аргумент на `true` (~line 1360):
```js
list.appendChild(makeEndpoint('Конец', state.solution.length, true));
```

**1e. Блокировать WASD когда активен overlay**
Клавиши двигают плашки во время вычисления. Добавить guard в `keydown` (~line 1445):
```js
if (document.getElementById('computing-overlay').classList.contains('active')) return;
```

---

### Task 2: Import dialog — Escape очищает `_importPending`

Нативный Escape не вызывает обработчик «Отмена» → `_importPending` остаётся ненулевым → при следующем открытии диалога применяется старый контент. Добавить (~line 1234):
```js
document.getElementById('import-dialog').addEventListener('close', () => {
  _importPending = null;
});
```

---

### Task 3: `onWorkerMessage` — проверка стейджа перед `switchToSolve()`

Устаревший BFS-ответ (сообщение было в event loop до `terminate()`) вызывает `switchToSolve()` после Cancel. Добавить guard (~line 1773):
```js
if (state.stage !== 'config') return;
```
(после проверки `data.solution === null`, перед мутацией state)

---

### Task 4: Solve-token (`solveId`) — защита от устаревших BFS-ответов

Даже с Task 3 остаётся сценарий: Cancel → сразу снова config stage → прилетает старый ответ, перезаписывает `state.solution`.

**Воркер (`<script type="text/x-worker">`):**
```js
self.postMessage({ type: 'solve', solution, solveId: data.solveId });
```

**Main thread:**
```js
let solveId = 0;
// в btn-start handler:
worker.postMessage({ type: 'solve', plates: state.plates, solveId: ++solveId });
// в onWorkerMessage:
if (data.type === 'solve' && data.solveId !== solveId) return;
```

---

### Task 5: Удалить мёртвый код из Script #3 (main thread)

`bfsSolve`, `isGoal`, `compressPath` в main thread никогда не вызываются — весь BFS через воркер. Устаревшая реализация (O(N²) копирование пути, нет `onProgress`). Строки ~719–816. Копии в воркере (`<script type="text/x-worker">`) трогать не нужно.

---

### Task 6: Валидация `deps` при импорте

`applyImportedConfig` не проверяет:
- поля `deps` (`targetId`, `direction`, `steps`)
- одинаковый `positions` у всех плашек
- что `id` образуют строго `1..N` (BFS использует `newPos[plateId - 1]` → краш при пропусках)

Полная новая версия `applyImportedConfig` в плане.

---

## Фича: Detached Exploration (ручное управление во время solve)

### Суть

Сейчас на вкладке solve A/D управляют шагами по BFS-решению, прямое движение плашек недоступно. Нужно "detached" состояние: пользователь переключается в режим ручного управления, BFS-решение сохраняется, ручные ходы пишутся в историю, можно в любой момент вернуться к точке отрыва.

### UX

Кнопка-переключатель **"Свободное движение"** на панели solve. При нажатии:
- Сохраняем `detachPositions` (текущее состояние плашек) и `detachStep` (индекс в BFS-решении)
- W/S выбирают активную плашку (как в config)
- A/D двигают выбранную плашку напрямую
- Каждый ход пишется в `exploreHistory[]`
- Кнопка "Вернуться к решению" восстанавливает `detachPositions` и `solverStep = detachStep`

### Левая панель в detached-режиме

```
Начало
  1A
  2D          ← выполненные шаги до detach
─── свободное перемещение ───
> 3A          ← текущий ручной ход (exploreHistory)
  1D
─── решение (от точки отрыва) ───
  2A          ← оставшийся хвост BFS-решения
  1D3
  Конец
```

### Данные

```js
// добавить в state:
state.solveMode = 'following' | 'exploring'
state.exploreHistory = []       // ручные ходы после detach
state.detachPositions = null    // снимок плашек на момент detach
state.detachStep = null         // solverStep на момент detach
```

### Инвариант

`state.solution` и `state.cachedSolution` не мутируются при ручных ходах. BFS-решение всегда доступно для возврата.

### Триггер detach

Нажатие на кнопку "Свободное движение" в solve-режиме. A/D и кнопки шагов в following-режиме работают как сейчас и detach не вызывают.

### Возврат из detach

Нажатие "Вернуться к решению" (или повторное нажатие переключателя):
- `state.plates` восстанавливаются из `detachPositions`
- `state.solverStep = state.detachStep`
- `state.solveMode = 'following'`
- `exploreHistory` очищается (одно детач-дерево за раз)

---

## Критический баг — исправлен (2026-06-13)

### Транзитивные зависимости в `computeMove` — **FIXED**

**Проблема:** `computeMove` рекурсивно обходил граф зависимостей. При движении плашки 5 (deps: 3→обратно) функция шла в зависимости самой 3 (1, 2, 4), и те тоже двигались. Итого — все плашки конфигурации реагировали на одно движение.

**Ожидаемое поведение:** зависимости нетранзитивны. Если A→B и B→C, движение A затрагивает только B. C двигается только при прямом ходе B.

**Исправление:** убрана рекурсия в `computeMove` (main thread, line ~674) и его копии в воркере (line ~1547). Вместо `collect(id, delta)` с рекурсивным обходом — плоский цикл по `primary.deps`.

**Затронутые места:**
- `computeMove` main thread: полностью переписан
- `computeMove` worker (`<script type="text/x-worker">`): полностью переписан
- `applyMove`, WASD, `solveStepForward/Back`, BFS в воркере — все используют `computeMove` и автоматически стали корректными
- Мёртвый `bfsSolve` в main thread (Script #3) — тоже использует `computeMove`, но будет удалён в рамках Task 5

**Побочный эффект:** BFS находит другие решения (пространство состояний изменилось). Это ожидаемо и корректно.

**Документация обновлена:** spec (Movement + Constraints), README (описание механики).
