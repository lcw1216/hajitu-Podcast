import asyncio
import json
import logging
import signal
import websockets
from game import GameState, MIN_PLAYERS
from app import log_game_action, verify_token
import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

HOST = "127.0.0.1"
PORT = 9002
HEARTBEAT_INTERVAL = 30
HEARTBEAT_TIMEOUT = 10


class ConnectionManager:
    def __init__(self):
        self.rooms = {}
        self.connections = {}

    def add_connection(self, player_id, websocket):
        self.connections[player_id] = websocket

    def remove_connection(self, player_id):
        self.connections.pop(player_id, None)

    def get_game(self, room_id):
        return self.rooms.get(room_id)

    def create_game(self, room_id, log_callback=None):
        if room_id not in self.rooms:
            self.rooms[room_id] = GameState(room_id, log_callback=log_callback)
        return self.rooms[room_id]

    def remove_game(self, room_id):
        self.rooms.pop(room_id, None)

    def get_connection(self, player_id):
        return self.connections.get(player_id)


manager = ConnectionManager()


async def heartbeat(websocket):
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            try:
                pong = await websocket.ping()
                await asyncio.wait_for(pong, timeout=HEARTBEAT_TIMEOUT)
            except asyncio.TimeoutError:
                logger.info("Heartbeat timeout, closing connection")
                await websocket.close()
                break
            except Exception:
                break
    except asyncio.CancelledError:
        pass


async def handle_client(websocket, path=None):
    player_id = None
    room_id = None
    heartbeat_task = None

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "join":
                    player_id = data.get("data", {}).get("user_id")
                    room_id = data.get("data", {}).get("room_id")
                    token = data.get("data", {}).get("token")

                    if not player_id or not room_id:
                        await send_error(websocket, "user_id and room_id required")
                        continue

                    if not verify_token(player_id, token):
                        await send_error(websocket, "authentication failed")
                        player_id = None
                        room_id = None
                        continue

                    game = manager.create_game(room_id, log_callback=log_game_action)
                    try:
                        game.add_player(player_id, f"Player_{player_id}")
                    except ValueError as e:
                        await send_error(websocket, str(e))
                        continue

                    manager.add_connection(player_id, websocket)

                    heartbeat_task = asyncio.create_task(heartbeat(websocket))

                    await send_message(websocket, {
                        "type": "joined",
                        "data": {"room_id": room_id, "player_id": player_id},
                    })

                    state = game.get_state(requesting_player_id=player_id)
                    await send_message(websocket, state)

                    await broadcast_state(room_id, exclude=player_id)

                    active_count = game.get_player_count()
                    if active_count >= MIN_PLAYERS:
                        game.start_game()
                        logger.info(f"Auto-start game in room {room_id} with {active_count} players")
                        await broadcast_state(room_id)

                elif msg_type == "player_action":
                    if not room_id or not manager.get_game(room_id):
                        await send_error(websocket, "Not in a room")
                        continue

                    action_data = data.get("data", {})
                    action = action_data.get("action")
                    amount = action_data.get("amount", 0)

                    if not isinstance(amount, (int, float)) or amount < 0:
                        await send_error(websocket, "Invalid amount")
                        continue

                    amount = int(amount)

                    game = manager.get_game(room_id)
                    try:
                        result = game.process_action(player_id, action, amount)
                    except ValueError as e:
                        await send_error(websocket, str(e))
                        continue

                    await broadcast_state(room_id)

                    hand_result = result.get("hand_result") if isinstance(result, dict) else None
                    if hand_result:
                        logger.info(f"Hand result in room {room_id}: {len(hand_result.get('data', {}).get('winners', []))} winners")
                        await broadcast_message(room_id, hand_result)

                        active_count = game.get_player_count()
                        if active_count >= MIN_PLAYERS:
                            game.start_game()
                            logger.info(f"Auto-start next hand in room {room_id}")
                            await broadcast_state(room_id)

                else:
                    await send_error(websocket, f"Unknown message type: {msg_type}")

            except json.JSONDecodeError:
                await send_error(websocket, "Invalid JSON")
            except ValueError as e:
                await send_error(websocket, str(e))
            except Exception as e:
                logger.exception(f"Error handling message: {e}")
                await send_error(websocket, "Internal error")

    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Player {player_id} disconnected")
    finally:
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()
        if player_id:
            manager.remove_connection(player_id)
        if room_id:
            game = manager.get_game(room_id)
            if game:
                game.remove_player(player_id)
                if game.get_player_count() == 0:
                    manager.remove_game(room_id)
                else:
                    await broadcast_state(room_id)


async def send_message(websocket, message):
    await websocket.send(json.dumps(message))


async def send_error(websocket, error_msg):
    await send_message(websocket, {
        "type": "error",
        "data": {"message": error_msg},
    })


async def broadcast_state(room_id, exclude=None):
    game = manager.get_game(room_id)
    if not game:
        return
    for player in game.players:
        if player.id == exclude:
            continue
        conn = manager.get_connection(player.id)
        if conn:
            state = game.get_state(requesting_player_id=player.id)
            try:
                await send_message(conn, state)
            except websockets.exceptions.ConnectionClosed:
                logger.warning(f"Connection closed for player {player.id}, removing")
                manager.remove_connection(player.id)
            except Exception as e:
                logger.error(f"Failed to send state to player {player.id}: {e}")


async def broadcast_message(room_id, message, exclude=None):
    game = manager.get_game(room_id)
    if not game:
        return
    for player in game.players:
        if player.id == exclude:
            continue
        conn = manager.get_connection(player.id)
        if conn:
            try:
                await send_message(conn, message)
            except websockets.exceptions.ConnectionClosed:
                logger.warning(f"Connection closed for player {player.id}, removing")
                manager.remove_connection(player.id)
            except Exception as e:
                logger.error(f"Failed to send message to player {player.id}: {e}")


async def main():
    logger.info(f"WebSocket server starting on ws://{HOST}:{PORT}")

    shutdown_event = asyncio.Event()

    def signal_handler():
        logger.info("Shutting down WebSocket server...")
        shutdown_event.set()

    loop = asyncio.get_running_loop()
    try:
        loop.add_signal_handler(signal.SIGINT, signal_handler)
        loop.add_signal_handler(signal.SIGTERM, signal_handler)
    except NotImplementedError:
        pass

    async with websockets.serve(handle_client, HOST, PORT):
        await shutdown_event.wait()

    logger.info("WebSocket server stopped gracefully")


if __name__ == "__main__":
    asyncio.run(main())
