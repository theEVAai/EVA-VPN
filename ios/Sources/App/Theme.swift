import SwiftUI

/// Фирменный стиль EVA: та же палитра, что в настольном клиенте
/// и в приложении для Android.
enum Eva {
    static let black = Color(red: 0.051, green: 0.051, blue: 0.051)      // #0d0d0d
    static let panel = Color(red: 0.063, green: 0.063, blue: 0.063)      // #101010
    static let cream = Color(red: 0.847, green: 0.804, blue: 0.722)      // #d8cdb8
    static let creamDim = Color(red: 0.847, green: 0.804, blue: 0.722).opacity(0.42)
    static let blue = Color(red: 0.102, green: 0.239, blue: 0.800)       // #1a3dcc
    static let blue2 = Color(red: 0.141, green: 0.314, blue: 0.910)      // #2450e8
    static let danger = Color(red: 0.878, green: 0.341, blue: 0.310)     // #e0574f
    static let line = Color(red: 0.847, green: 0.804, blue: 0.722).opacity(0.16)

    static let mono = Font.system(.body, design: .monospaced)
}

/// Сердце с замочной скважиной — тот же контур, что на других платформах.
struct HeartShape: Shape {
    func path(in rect: CGRect) -> Path {
        // исходные координаты нарисованы в поле 120x112
        let sx = rect.width / 120
        let sy = rect.height / 112
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }

        var path = Path()
        path.move(to: p(60, 104))
        path.addCurve(to: p(8, 39), control1: p(60, 104), control2: p(8, 74))
        path.addCurve(to: p(41, 6), control1: p(8, 19), control2: p(24, 6))
        path.addCurve(to: p(60, 17), control1: p(51, 6), control2: p(57, 11))
        path.addCurve(to: p(79, 6), control1: p(63, 11), control2: p(69, 6))
        path.addCurve(to: p(112, 39), control1: p(96, 6), control2: p(112, 19))
        path.addCurve(to: p(60, 104), control1: p(112, 74), control2: p(60, 104))
        path.closeSubpath()
        return path
    }
}

/// Внутреннее кремовое сердце.
struct HeartInnerShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 120
        let sy = rect.height / 112
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }

        var path = Path()
        path.move(to: p(60, 96))
        path.addCurve(to: p(17, 41), control1: p(60, 96), control2: p(17, 70))
        path.addCurve(to: p(43, 14), control1: p(17, 24), control2: p(30, 14))
        path.addCurve(to: p(60, 23), control1: p(51, 14), control2: p(57, 18))
        path.addCurve(to: p(77, 14), control1: p(63, 18), control2: p(69, 14))
        path.addCurve(to: p(103, 41), control1: p(90, 14), control2: p(103, 24))
        path.addCurve(to: p(60, 96), control1: p(103, 70), control2: p(60, 96))
        path.closeSubpath()
        return path
    }
}

/// Замочная скважина: её цвет — метка активного ключа.
struct KeyholeShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 120
        let sy = rect.height / 112
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }

        var path = Path()
        path.addEllipse(in: CGRect(
            x: rect.minX + 49 * sx,
            y: rect.minY + 34 * sy,
            width: 22 * sx,
            height: 22 * sy
        ))
        path.move(to: p(55.5, 52))
        path.addLine(to: p(52, 70))
        path.addLine(to: p(68, 70))
        path.addLine(to: p(64.5, 52))
        path.closeSubpath()
        return path
    }
}

/// Сердце целиком, как кнопка включения.
struct HeartView: View {
    var connected: Bool
    var keyColor: Color = Eva.blue2

    var body: some View {
        ZStack {
            HeartShape()
                .fill(connected ? Eva.blue : Color.clear)
            HeartShape()
                .stroke(connected ? Eva.blue : Eva.creamDim, lineWidth: 3)
            if connected {
                HeartInnerShape().fill(Eva.cream)
            }
            KeyholeShape().fill(connected ? keyColor : Eva.creamDim)
        }
        .frame(width: 190, height: 178)
        .animation(.easeInOut(duration: 0.35), value: connected)
    }
}
