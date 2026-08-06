import ctypes
import os
import sys
import logging

logger = logging.getLogger(__name__)

HAND_HIGH_CARD = 0
HAND_ONE_PAIR = 1
HAND_TWO_PAIR = 2
HAND_THREE_OF_A_KIND = 3
HAND_STRAIGHT = 4
HAND_FLUSH = 5
HAND_FULL_HOUSE = 6
HAND_FOUR_OF_A_KIND = 7
HAND_STRAIGHT_FLUSH = 8
HAND_ROYAL_FLUSH = 9

HAND_NAMES = {
    HAND_HIGH_CARD: "高牌",
    HAND_ONE_PAIR: "一对",
    HAND_TWO_PAIR: "两对",
    HAND_THREE_OF_A_KIND: "三条",
    HAND_STRAIGHT: "顺子",
    HAND_FLUSH: "同花",
    HAND_FULL_HOUSE: "葫芦",
    HAND_FOUR_OF_A_KIND: "四条",
    HAND_STRAIGHT_FLUSH: "同花顺",
    HAND_ROYAL_FLUSH: "皇家同花顺",
}

_lib = None
_lib_error = None

try:
    _ext = {"win32": ".dll", "darwin": ".dylib"}.get(sys.platform, ".so")
    _dll_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"hand_eval{_ext}")
    if os.path.exists(_dll_path):
        _lib = ctypes.CDLL(_dll_path)

        _lib.eval_hand.argtypes = [ctypes.c_int * 7]
        _lib.eval_hand.restype = ctypes.c_int

        _lib.compare_hands.argtypes = [ctypes.c_int * 7, ctypes.c_int * 7]
        _lib.compare_hands.restype = ctypes.c_int

        class _HandScoreFull(ctypes.Structure):
            _fields_ = [
                ("rank", ctypes.c_int),
                ("kickers", ctypes.c_int * 5),
            ]

        _lib.eval_hand_full.argtypes = [ctypes.c_int * 7]
        _lib.eval_hand_full.restype = _HandScoreFull

        _lib.compare_with_scores.argtypes = [
            ctypes.c_int, ctypes.c_int * 5,
            ctypes.c_int, ctypes.c_int * 5,
        ]
        _lib.compare_with_scores.restype = ctypes.c_int

        logger.info(f"Hand evaluation engine loaded: {_dll_path}")
    else:
        _lib_error = f"牌型引擎库未找到: {_dll_path}"
        logger.warning(_lib_error)
except Exception as e:
    _lib_error = f"牌型引擎加载失败: {e}"
    logger.warning(_lib_error)


def _check_lib():
    if _lib is None:
        raise ImportError(_lib_error or "牌型引擎未加载")


def eval_hand(cards):
    _check_lib()
    if len(cards) != 7:
        raise ValueError("需要7张牌")
    arr = (ctypes.c_int * 7)(*cards)
    return _lib.eval_hand(arr)


def eval_hand_full(cards):
    _check_lib()
    if len(cards) != 7:
        raise ValueError("需要7张牌")
    arr = (ctypes.c_int * 7)(*cards)
    result = _lib.eval_hand_full(arr)
    return {
        "rank": result.rank,
        "kickers": list(result.kickers),
    }


def compare_hands(hand_a, hand_b):
    _check_lib()
    if len(hand_a) != 7 or len(hand_b) != 7:
        raise ValueError("每手牌需要7张")
    arr_a = (ctypes.c_int * 7)(*hand_a)
    arr_b = (ctypes.c_int * 7)(*hand_b)
    return _lib.compare_hands(arr_a, arr_b)


def compare_with_scores(rank_a, kickers_a, rank_b, kickers_b):
    _check_lib()
    if len(kickers_a) != 5 or len(kickers_b) != 5:
        raise ValueError("踢脚牌需要5个值")
    ka = (ctypes.c_int * 5)(*kickers_a)
    kb = (ctypes.c_int * 5)(*kickers_b)
    return _lib.compare_with_scores(rank_a, ka, rank_b, kb)


def get_hand_name(rank):
    return HAND_NAMES.get(rank, "未知")
