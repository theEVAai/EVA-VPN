import SwiftUI

/// Правила: готовые наборы и свои.
///
/// Это и есть замена списку программ с компьютера. На iPhone Apple не даёт
/// обычному приложению делить туннель по программам, поэтому настройка идёт
/// по адресам — как в Clash и Shadowrocket, но без их терминов.
///
/// Человек вводит адрес, а приложение сразу пишет, как оно его поняло:
/// «Домен example.com и все его поддомены», «Диапазон адресов 10.0.0.0/8»,
/// «Всё, что идёт на порт 443». Так не нужно знать разницу между
/// DOMAIN-SUFFIX, DOMAIN-KEYWORD и IP-CIDR — приложение выбирает само,
/// а человек видит выбор до того, как правило будет добавлено.
struct RulesView: View {

    private let store = Store.shared

    @State private var enabledModules: Set<String> = []
    @State private var rules: [UserRule] = []
    @State private var input: String = ""

    private var understood: Understood? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : Patterns.understand(text)
    }

    var body: some View {
        ZStack {
            Eva.black.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("ПРАВИЛА")
                        .font(.system(size: 17, weight: .bold, design: .monospaced))
                        .foregroundColor(Eva.cream)

                    /* ---------------- готовые наборы ---------------- */
                    Text("// готовые наборы")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(Eva.creamDim)

                    VStack(spacing: 0) {
                        ForEach(Array(RuleModules.all.enumerated()), id: \.element.id) { index, module in
                            if index > 0 { Divider().background(Eva.line) }
                            moduleRow(module)
                        }
                    }
                    .background(Eva.panel)
                    .overlay(Rectangle().stroke(Eva.line, lineWidth: 1))

                    /* ---------------- свои правила ---------------- */
                    Text("// свои правила")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(Eva.creamDim)
                        .padding(.top, 6)

                    Text("Введите адрес — приложение само поймёт, что это, и напишет ниже, как оно его поняло.")
                        .font(.system(size: 12))
                        .foregroundColor(Eva.creamDim)

                    TextField("Адрес, домен или порт", text: $input)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundColor(Eva.cream)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(10)
                        .background(Eva.panel)
                        .overlay(Rectangle().stroke(Eva.line, lineWidth: 1))

                    if let understood {
                        Text(understood.explanation)
                            .font(.system(size: 12))
                            .foregroundColor(Eva.blue2)
                    }

                    HStack(spacing: 8) {
                        ForEach(RuleAction.allCases, id: \.self) { action in
                            Button(action.title) { add(action) }
                                .buttonStyle(GhostButton())
                        }
                    }

                    VStack(spacing: 0) {
                        if rules.isEmpty {
                            plainRow("Своих правил пока нет", nil, nil)
                        } else {
                            ForEach(Array(rules.enumerated()), id: \.element.id) { index, rule in
                                if index > 0 { Divider().background(Eva.line) }
                                ruleRow(rule)
                            }
                        }
                    }
                    .background(Eva.panel)
                    .overlay(Rectangle().stroke(Eva.line, lineWidth: 1))
                }
                .padding(20)
            }
        }
        .onAppear(perform: reload)
    }

    private func moduleRow(_ module: RuleModule) -> some View {
        let binding = Binding<Bool>(
            get: { enabledModules.contains(module.id) },
            set: { on in
                store.setModule(module.id, enabled: on)
                enabledModules = store.enabledModules
            }
        )

        var title = module.title + "  ·  " + module.action.title
        if let badge = module.badge { title += "  ·  " + badge }

        return Toggle(isOn: binding) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 14))
                    .foregroundColor(Eva.cream)
                Text(module.hint)
                    .font(.system(size: 11))
                    .foregroundColor(Eva.creamDim)
            }
        }
        .tint(Eva.blue2)
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
    }

    private func ruleRow(_ rule: UserRule) -> some View {
        plainRow(
            rule.action.title + ": " + rule.pattern,
            Patterns.understand(rule.pattern).explanation,
            AnyView(
                Button("×") {
                    rules.removeAll { $0.pattern == rule.pattern }
                    store.userRules = rules
                }
                .buttonStyle(GhostButton())
            )
        )
    }

    private func plainRow(_ title: String, _ hint: String?, _ trailing: AnyView?) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 14))
                    .foregroundColor(Eva.cream)
                if let hint {
                    Text(hint)
                        .font(.system(size: 11))
                        .foregroundColor(Eva.creamDim)
                }
            }
            Spacer()
            trailing
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
    }

    private func add(_ action: RuleAction) {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        var list = rules.filter { $0.pattern.lowercased() != text.lowercased() }
        list.append(UserRule(pattern: text, action: action))
        store.userRules = list
        rules = list
        input = ""
    }

    private func reload() {
        enabledModules = store.enabledModules
        rules = store.userRules
    }
}
