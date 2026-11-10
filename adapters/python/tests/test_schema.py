from argentic_ai.core import to_argentic_schema


def test_flat_schema_is_trimmed_as_before():
    out = to_argentic_schema({
        "$schema": "x", "type": "object", "additionalProperties": False,
        "properties": {"a": {"type": "string", "title": "A", "description": "d"}, "tags": {"type": "array", "items": {"type": "string", "enum": ["x"]}}},
        "required": ["a"],
    })
    assert out == {"type": "object", "properties": {"a": {"type": "string", "description": "d"}, "tags": {"type": "array", "items": {"type": "string"}}}, "required": ["a"]}


def test_nested_object_or_array_of_objects_goes_through_whole():
    nested = {
        "$schema": "http://json-schema.org/draft-07/schema#", "type": "object",
        "properties": {
            "order_id": {"type": "string"},
            "payload": {"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]},
            "items": {"type": "array", "items": {"type": "object", "properties": {"ref": {"type": "string"}}}},
        },
        "required": ["order_id"],
    }
    out = to_argentic_schema(nested)
    assert "$schema" not in out
    assert out["properties"]["payload"] == nested["properties"]["payload"]
    assert out["properties"]["items"] == nested["properties"]["items"]
    assert out["required"] == ["order_id"]
