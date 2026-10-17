import Foundation

enum Subscription {
    private static let maximumBytes = 2 * 1024 * 1024

    static func fetch(_ input: String) async throws -> [Profile] {
        guard let url = URL(string: input), url.scheme?.lowercased() == "https",
              url.host != nil, url.user == nil, url.password == nil else {
            throw ParseError(message: "Для подписки нужен HTTPS-адрес без логина и пароля в адресе.")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: SecureRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.setValue("EVA VPN", forHTTPHeaderField: "User-Agent")
        request.setValue("text/plain, */*", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw ParseError(message: "Сервер не отдал подписку. Проверьте срок действия ссылки.")
        }
        if response.expectedContentLength > Int64(maximumBytes) {
            throw ParseError(message: "Подписка превышает 2 МБ.")
        }
        var data = Data()
        for try await byte in bytes {
            if data.count >= maximumBytes { throw ParseError(message: "Подписка превышает 2 МБ.") }
            data.append(byte)
        }
        guard let body = String(data: data, encoding: .utf8) else {
            throw ParseError(message: "Подписка должна содержать текст UTF-8.")
        }
        let profiles = try Keys.parseMany(body)
        if profiles.isEmpty { throw ParseError(message: "В подписке нет совместимых ключей.") }
        return profiles
    }
}

private final class SecureRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        let url = request.url
        completionHandler(url?.scheme?.lowercased() == "https" && url?.user == nil && url?.password == nil ? request : nil)
    }
}
