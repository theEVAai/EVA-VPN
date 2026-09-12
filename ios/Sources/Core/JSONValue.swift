import Foundation

/// Значение JSON, которое умеет храниться в настройках и превращаться
/// в готовый текст конфигурации.
///
/// В Swift нет готового аналога JSONObject из Android, а `[String: Any]`
/// не кодируется через Codable. Поэтому здесь простой перечислимый тип:
/// он и хранится вместе с профилем, и собирается в строку для ядра.
indirect enum JSONValue: Codable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    // MARK: - Codable

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let v = try? container.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? container.decode(Int.self) {
            self = .int(v)
        } else if let v = try? container.decode(Double.self) {
            self = .double(v)
        } else if let v = try? container.decode(String.self) {
            self = .string(v)
        } else if let v = try? container.decode([JSONValue].self) {
            self = .array(v)
        } else if let v = try? container.decode([String: JSONValue].self) {
            self = .object(v)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "не похоже на JSON"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .string(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        }
    }

    // MARK: - Превращение в объекты Foundation

    /// Для JSONSerialization: словари, массивы и примитивы.
    var foundationValue: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let v): return v
        case .int(let v): return v
        case .double(let v): return v
        case .string(let v): return v
        case .array(let v): return v.map { $0.foundationValue }
        case .object(let v): return v.mapValues { $0.foundationValue }
        }
    }

    /// Готовая строка конфигурации.
    func jsonString(pretty: Bool = true) throws -> String {
        let options: JSONSerialization.WritingOptions =
            pretty ? [.prettyPrinted, .withoutEscapingSlashes] : [.withoutEscapingSlashes]
        let data = try JSONSerialization.data(withJSONObject: foundationValue, options: options)
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}
