import hashlib
from collections import OrderedDict

from routeopt.core.models import Location


def cache_key(kind: str, points: list[Location]) -> str:
    digest = hashlib.sha256(kind.encode())
    for p in points:
        digest.update(f"{p.lat:.5f},{p.lon:.5f};".encode())
    return digest.hexdigest()


class LruCache[T]:
    def __init__(self, capacity: int = 256) -> None:
        self._capacity = capacity
        self._items: OrderedDict[str, T] = OrderedDict()

    def get(self, key: str) -> T | None:
        if key not in self._items:
            return None
        self._items.move_to_end(key)
        return self._items[key]

    def put(self, key: str, value: T) -> None:
        self._items[key] = value
        self._items.move_to_end(key)
        while len(self._items) > self._capacity:
            self._items.popitem(last=False)

    def __len__(self) -> int:
        return len(self._items)
